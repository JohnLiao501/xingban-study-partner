/**
 * 阶段 3 B0：启动稳定性与 GPU `launch-failed` 诊断。
 *
 * 每次运行都使用操作系统临时目录下的随机隔离 `userData`，启动 Electron 后
 * 只等待主界面外壳与会话设置弹窗就绪，不请求屏幕权限、不读取正式数据库、
 * 不访问真实外网。每一次尝试（成功或失败）都必须完成子进程退出、
 * 隐私扫描与精确目录删除后才进入下一次。
 *
 * 用法：node scripts/diagnose-stage3-startup.mjs [--runs=3] [--timeout-ms=60000]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { Stage3MockVisionServer } from "../dist-electron/electron/acceptance/mock-vision-server.js";
import {
  auditStage3AcceptanceDirectory,
  removeStage3AcceptanceDirectory,
} from "../dist-electron/electron/acceptance/stage3-evidence.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readNumberArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = Number.parseInt(raw.slice(prefix.length), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const plannedRuns = readNumberArgument("runs", 3);
const runTimeoutMs = readNumberArgument("timeout-ms", 60_000);
const settleMs = 1_500;

/**
 * 子进程环境必须剔除 `ELECTRON_RUN_AS_NODE`：一旦该变量存在，Electron 可执行
 * 文件会以纯 Node 运行，主进程、`electron` 内建模块、窗口与 GPU 进程全部缺失，
 * 表现为 `SyntaxError: ... does not provide an export named 'safeStorage'` 或
 * 莫名的 renderer/GPU `launch-failed`。这是 B0 定位到的根因，必须以环境变量
 * 方式消除，而不是关闭硬件加速掩盖。
 */
function buildChildEnvironment(extra) {
  const environment = { ...process.env, ...extra };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

const STARTUP_PREFIX = "[Acceptance:Startup] ";
const SHUTDOWN_PREFIX = "[Acceptance:Stage3:Shutdown] ";
const NOISE_PATTERN = /(gpu|launch-failed|render-process-gone|child-process|error|fail)/i;

function waitForChildExit(target, timeoutMs) {
  if (!target || target.exitCode !== null || target.signalCode !== null) {
    return Promise.resolve(true);
  }
  return new Promise((resolve) => {
    let settled = false;
    const finish = (exited) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      target.removeListener("exit", onExit);
      target.removeListener("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(target.exitCode !== null || target.signalCode !== null);
    const timer = setTimeout(() => finish(false), timeoutMs);
    target.once("exit", onExit);
    target.once("error", onError);
  });
}

async function runTaskkill(pid) {
  return await new Promise((resolve) => {
    const killer = spawn("taskkill.exe", ["/PID", String(pid), "/T", "/F"], {
      windowsHide: true,
      stdio: "ignore",
    });
    killer.once("error", () => resolve(false));
    killer.once("exit", (code) => resolve(code === 0 || code === 128));
  });
}

async function terminateChildTree(target) {
  if (!target || target.exitCode !== null || target.signalCode !== null) {
    return { exited: true, forced: false };
  }
  try {
    target.kill("SIGTERM");
  } catch {
    // 继续以精确 PID 树强制清理。
  }
  if (await waitForChildExit(target, 5_000)) return { exited: true, forced: false };
  if (process.platform === "win32" && target.pid) await runTaskkill(target.pid);
  else {
    try {
      target.kill("SIGKILL");
    } catch {
      // 由最终 exit 等待决定是否失败。
    }
  }
  return { exited: await waitForChildExit(target, 5_000), forced: true };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runOnce(runIndex) {
  const acceptanceDirectory = await mkdtemp(path.join(os.tmpdir(), "xingban-stage3-acceptance-"));
  const mockServer = new Stage3MockVisionServer();
  const startupEvents = [];
  const noiseLines = [];
  let shutdownEvidence = { seen: false, captureStopped: false, probeStopped: false, pass: false };
  let child = null;
  let interrupted = false;
  let terminalStage = null;

  const settle = () => {
    if (interrupted) return Promise.resolve({ code: 1, signal: "SIGTERM" });
    return Promise.resolve({ code: 1, signal: null });
  };

  let finished;
  const finishedPromise = new Promise((resolve) => {
    finished = (stage) => {
      if (terminalStage === null) {
        terminalStage = stage;
        resolve(stage);
      }
    };
  });

  try {
    const mockBaseUrl = await mockServer.start();
    child = spawn(electronPath, [projectRoot], {
      cwd: projectRoot,
      env: buildChildEnvironment({
        XINGBAN_STAGE3_ACCEPTANCE: "1",
        XINGBAN_ACCEPTANCE_USER_DATA: acceptanceDirectory,
        XINGBAN_ACCEPTANCE_MOCK_BASE_URL: mockBaseUrl,
      }),
      stdio: ["inherit", "pipe", "pipe"],
      windowsHide: false,
    });

    let stdoutBuffer = "";
    const consumeLine = (line) => {
      if (line.startsWith(STARTUP_PREFIX)) {
        let event = null;
        try {
          event = JSON.parse(line.slice(STARTUP_PREFIX.length));
        } catch {
          event = null;
        }
        if (event) {
          startupEvents.push(event);
          if (event.stage === "startup-complete") finished("startup-complete");
          else if (event.stage === "startup-failed") finished("startup-failed");
        }
      } else if (line.startsWith(SHUTDOWN_PREFIX)) {
        try {
          const value = JSON.parse(line.slice(SHUTDOWN_PREFIX.length));
          shutdownEvidence = {
            seen: true,
            captureStopped: value?.captureStopped === true,
            probeStopped: value?.probeStopped === true,
            pass: value?.pass === true,
          };
        } catch {
          shutdownEvidence = { seen: true, captureStopped: false, probeStopped: false, pass: false };
        }
      } else if (NOISE_PATTERN.test(line) && noiseLines.length < 40) {
        noiseLines.push(line.slice(0, 300));
      }
    };
    child.stdout.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      process.stdout.write(chunk);
      stdoutBuffer += text;
      let index = stdoutBuffer.indexOf("\n");
      while (index >= 0) {
        consumeLine(stdoutBuffer.slice(0, index).trimEnd());
        stdoutBuffer = stdoutBuffer.slice(index + 1);
        index = stdoutBuffer.indexOf("\n");
      }
    });
    child.stdout.on("end", () => {
      if (stdoutBuffer.trim()) consumeLine(stdoutBuffer.trimEnd());
      stdoutBuffer = "";
    });
    child.stderr.on("data", (chunk) => {
      process.stderr.write(chunk);
      const text = chunk.toString("utf8");
      if (NOISE_PATTERN.test(text) && noiseLines.length < 40) {
        noiseLines.push(text.replace(/\s+/g, " ").trim().slice(0, 300));
      }
    });
    child.once("exit", () => finished("child-exited"));
    child.once("error", () => finished("child-error"));

    const timeout = setTimeout(() => finished("timeout"), runTimeoutMs);
    terminalStage = await finishedPromise;
    clearTimeout(timeout);

    if (terminalStage === "startup-complete") {
      await sleep(settleMs);
    } else {
      interrupted = true;
    }
    const childResult = await settle();
    void childResult;
  } catch (error) {
    interrupted = true;
    noiseLines.push(`RUNNER_ERROR: ${error instanceof Error ? error.message.slice(0, 200) : "UNKNOWN"}`);
  } finally {
    const processCleanup = await terminateChildTree(child);
    await mockServer.close().catch(() => {});

    let privacy = { pass: false };
    let cleaned = false;
    if (processCleanup.exited) {
      try {
        privacy = await auditStage3AcceptanceDirectory(acceptanceDirectory);
      } catch {
        privacy = { pass: false };
      }
      try {
        cleaned = await removeStage3AcceptanceDirectory(acceptanceDirectory);
      } catch {
        cleaned = false;
      }
    }

    const complete = startupEvents.find((event) => event.stage === "startup-complete") ?? null;
    const gpu = startupEvents.find((event) => event.stage === "gpu-info") ?? null;
    const runtime = startupEvents.find((event) => event.stage === "runtime") ?? null;
    const crashes = startupEvents.filter((event) => event.stage === "child-process-gone");

    const record = {
      run: runIndex + 1,
      terminalStage,
      isBrowserProcess: runtime?.isBrowserProcess === true,
      processType: runtime?.processType ?? null,
      electronVersion: runtime?.electronVersion ?? null,
      exitCode: child?.exitCode ?? null,
      exitSignal: child?.signalCode ?? null,
      startupPass: complete?.pass === true,
      shellReady: complete?.shellReady === true,
      setupDialogReady: complete?.setupDialogReady === true,
      bootError: complete?.bootError === true,
      elapsedMs: complete?.elapsedMs ?? null,
      probeFailures: complete?.probeFailures ?? null,
      lastError: complete?.lastError ?? null,
      gpuRenderer: gpu?.glRenderer ?? null,
      childProcessGone: crashes.map((event) => ({
        type: event.type ?? null,
        reason: event.reason ?? null,
        exitCode: event.exitCode ?? null,
      })),
      shutdown: shutdownEvidence,
      processesExited: processCleanup.exited,
      forcedKill: processCleanup.forced,
      privacyPass: privacy.pass === true,
      cleanupRemoved: cleaned,
      noise: noiseLines.slice(0, 10),
    };
    record.pass =
      record.startupPass &&
      record.isBrowserProcess &&
      record.processesExited &&
      record.privacyPass &&
      record.cleanupRemoved;
    process.stdout.write(`[B0:Run] ${JSON.stringify(record)}\n`);
    return record;
  }
}

const records = [];
for (let index = 0; index < plannedRuns; index += 1) {
  records.push(await runOnce(index));
  if (index < plannedRuns - 1) await sleep(2_000);
}

const consecutivePass = records.every((record) => record.pass);
const summary = {
  plannedRuns,
  passedRuns: records.filter((record) => record.pass).length,
  consecutivePass,
  gpuRenderer: records.find((record) => record.gpuRenderer)?.gpuRenderer ?? null,
  childProcessGone: records.flatMap((record) => record.childProcessGone),
  runs: records,
};
process.stdout.write(`[B0:Summary] ${JSON.stringify(summary, null, 2)}\n`);
process.exitCode = consecutivePass ? 0 : 1;
