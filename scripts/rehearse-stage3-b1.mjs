/**
 * 阶段 3 B1：0～3:10 本地规则节点短预演。
 *
 * 只验证最容易浪费整场时间的两个固定节点：
 * - 2:00：允许进程保持前台 → focused / allowed_app / local-rule；
 * - 3:00：用户手动切到禁止进程并连续保持 ≥ 20 秒 → distracted / blocked_app / local-rule。
 *
 * 任一节点不符、事件形状违规、GPU 子进程反复崩溃（沙箱症状）或超时都会立即
 * 结束本场，不会继续等待完整 25 分钟；本预演通过也不算 G3-B。
 *
 * 隔离与清理与 G3-B runner 相同：随机临时 userData、回环 mock、子进程树退出
 * 确认、隐私扫描与精确目录删除。B1 阶段不允许任何 mock AI 请求。
 *
 * 用法：node scripts/rehearse-stage3-b1.mjs [--allow=notepad] [--block=mspaint] [--timeout-ms=480000]
 */
import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { Stage3MockVisionServer } from "../dist-electron/electron/acceptance/mock-vision-server.js";
import {
  evaluateStage3B1RunOutcome,
  Stage3B1RunTrace,
} from "../dist-electron/electron/acceptance/stage3-b1-trace.js";
import {
  auditStage3AcceptanceDirectory,
  removeStage3AcceptanceDirectory,
} from "../dist-electron/electron/acceptance/stage3-evidence.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROCESS_NAME_PATTERN = /^[^\\/:*?"<>|\r\n]{1,120}$/;
const GPU_CRASH_FAIL_FAST_THRESHOLD = 3;
const DEFAULT_TIMEOUT_MS = 480_000;

function readArgument(name, fallback) {
  const prefix = `--${name}=`;
  const raw = process.argv.find((arg) => arg.startsWith(prefix));
  if (!raw) return fallback;
  const value = raw.slice(prefix.length).trim();
  return value || fallback;
}

const allowProcess = readArgument("allow", "notepad");
const blockProcess = readArgument("block", "mspaint");
const timeoutMs = Number.parseInt(readArgument("timeout-ms", String(DEFAULT_TIMEOUT_MS)), 10);

if (!PROCESS_NAME_PATTERN.test(allowProcess) || !PROCESS_NAME_PATTERN.test(blockProcess)) {
  process.stderr.write("[B1:Final] {\"pass\":false,\"reason\":\"process_name_invalid\"}\n");
  process.exit(1);
}
if (allowProcess.toLowerCase() === blockProcess.toLowerCase()) {
  process.stderr.write("[B1:Final] {\"pass\":false,\"reason\":\"allow_block_must_differ\"}\n");
  process.exit(1);
}

function emitEvidence(label, value) {
  process.stdout.write(`[B1:${label}] ${JSON.stringify(value)}\n`);
}

process.stdout.write(`\n[B1 预演] 允许进程：${allowProcess}　禁止进程：${blockProcess}\n`);
process.stdout.write("[B1 预演] 应用启动后请完成一次选源并开始 25 分钟会话，然后：\n");
process.stdout.write(`[B1 预演] 1) 0:00～2:10 让 ${allowProcess} 保持前台；\n`);
process.stdout.write(`[B1 预演] 2) 2:10 后尽快切到 ${blockProcess} 并保持至少 20 秒；\n`);
process.stdout.write("[B1 预演] 3:00 节点判定完成后本脚本会自动关闭应用并清理，无需手动退出。\n\n");

/**
 * 子进程环境必须剔除 `ELECTRON_RUN_AS_NODE`（B0 根因一）：否则 Electron 以纯
 * Node 运行，没有主进程、窗口与 GPU，表现为莫名的 renderer/GPU launch-failed。
 */
function buildChildEnvironment(extra) {
  const environment = { ...process.env, ...extra };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function waitForChildExit(target, timeout) {
  if (!target || target.exitCode !== null || target.signalCode !== null) return Promise.resolve(true);
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
    const timer = setTimeout(() => finish(false), timeout);
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

const acceptanceDirectory = await mkdtemp(path.join(os.tmpdir(), "xingban-stage3-acceptance-"));
const mockServer = new Stage3MockVisionServer();
const trace = new Stage3B1RunTrace();
let child = null;
let interrupted = false;
let terminationPromise = null;
let terminationTarget = null;
let failFastReason = null;
let gpuCrashCount = 0;
let shellReady = false;
let setupDialogReady = false;
let shutdownEvidence = { seen: false, captureStopped: false, probeStopped: false, pass: false };

function requestChildTermination() {
  if (terminationTarget !== child) {
    terminationTarget = child;
    terminationPromise = terminateChildTree(child);
  }
  terminationPromise ??= terminateChildTree(child);
  return terminationPromise;
}

function stopChild() {
  interrupted = true;
  void requestChildTermination();
}

process.once("SIGINT", stopChild);
process.once("SIGTERM", stopChild);

const EVENT_PREFIX = "[Acceptance:Stage3] ";
const SHUTDOWN_PREFIX = "[Acceptance:Stage3:Shutdown] ";
const STARTUP_PREFIX = "[Acceptance:Startup] ";

function acceptStartupLine(line) {
  let event = null;
  try {
    event = JSON.parse(line.slice(STARTUP_PREFIX.length));
  } catch {
    event = null;
  }
  if (!event) return;
  if (event.stage === "shell-ready") shellReady = true;
  if (event.stage === "setup-dialog-ready") setupDialogReady = true;
  if (event.stage === "child-process-gone" && event.type === "GPU") {
    gpuCrashCount += 1;
    if (gpuCrashCount >= GPU_CRASH_FAIL_FAST_THRESHOLD && !failFastReason) {
      // B0 根因三：沙箱化外壳会反复杀死 GPU 进程。真实验收不得在该环境继续。
      failFastReason = "gpu_process_crash_loop";
      void requestChildTermination();
    }
  }
}

function acceptStdoutLine(line) {
  if (line.startsWith(EVENT_PREFIX)) {
    let parsed = null;
    try {
      parsed = JSON.parse(line.slice(EVENT_PREFIX.length));
    } catch {
      parsed = null;
    }
    const decision = trace.accept(parsed);
    if (decision === "stop-fail") {
      failFastReason ??= "trace_failed";
      void requestChildTermination();
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
  } else if (line.startsWith(STARTUP_PREFIX)) {
    acceptStartupLine(line);
  }
}

let childResult = { code: 1, signal: null };
let processCleanup = { exited: false, forced: false };
let mockSummary = { requestCount: 0, scenarioRequestCount: 0, consumedSteps: 0, remainingSteps: 5, invalidRequestCount: 0 };
let privacyAudit = { pass: false };
let cleanupRemoved = false;
const startedAt = Date.now();

const timeout = setTimeout(() => {
  if (!failFastReason) {
    failFastReason = "timeout";
    void requestChildTermination();
  }
}, Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);

try {
  const mockBaseUrl = await mockServer.start();
  emitEvidence("Start", {
    isolatedUserData: true,
    loopbackMock: true,
    nodes: ["2:00", "3:00"],
    plannedRehearsal: "0:00-3:10",
  });

  child = spawn(electronPath, [projectRoot], {
    cwd: projectRoot,
    env: buildChildEnvironment({
      XINGBAN_STAGE3_ACCEPTANCE: "1",
      XINGBAN_STAGE3_B1_REHEARSAL: "1",
      XINGBAN_STAGE3_B1_DISABLE_CONTENT_PROTECTION: "1",
      XINGBAN_ACCEPTANCE_USER_DATA: acceptanceDirectory,
      XINGBAN_ACCEPTANCE_MOCK_BASE_URL: mockBaseUrl,
      XINGBAN_ACCEPTANCE_ALLOW_PROCESS: allowProcess,
      XINGBAN_ACCEPTANCE_BLOCK_PROCESS: blockProcess,
    }),
    stdio: ["inherit", "pipe", "pipe"],
    windowsHide: false,
  });
  let stdoutBuffer = "";
  child.stdout.on("data", (chunk) => {
    process.stdout.write(chunk);
    stdoutBuffer += chunk.toString("utf8");
    let newlineIndex = stdoutBuffer.indexOf("\n");
    while (newlineIndex >= 0) {
      acceptStdoutLine(stdoutBuffer.slice(0, newlineIndex).trimEnd());
      stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
      newlineIndex = stdoutBuffer.indexOf("\n");
    }
  });
  child.stdout.on("end", () => {
    if (stdoutBuffer.trim()) acceptStdoutLine(stdoutBuffer.trimEnd());
    stdoutBuffer = "";
  });
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  if (interrupted) void requestChildTermination();
  childResult = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signal) => resolve({ code: code ?? 1, signal }));
  });
} catch (error) {
  if (!failFastReason) failFastReason = "runner_error";
  emitEvidence("RunnerError", {
    code: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN_RUNNER_ERROR",
    pass: false,
  });
} finally {
  clearTimeout(timeout);
  processCleanup = await requestChildTermination();
  emitEvidence("Processes", { ...processCleanup, pass: processCleanup.exited });

  mockSummary = mockServer.getSummary();
  await mockServer.close().catch(() => {});
  emitEvidence("Mock", {
    ...mockSummary,
    pass: mockSummary.requestCount === 0 && mockSummary.invalidRequestCount === 0,
  });

  if (processCleanup.exited) {
    try {
      privacyAudit = await auditStage3AcceptanceDirectory(acceptanceDirectory);
    } catch {
      privacyAudit = { pass: false };
    }
  }
  emitEvidence("Privacy", privacyAudit);

  if (processCleanup.exited) {
    try {
      cleanupRemoved = await removeStage3AcceptanceDirectory(acceptanceDirectory);
    } catch {
      cleanupRemoved = false;
    }
  }
  emitEvidence("Cleanup", { removed: cleanupRemoved, pass: cleanupRemoved });
}

process.off("SIGINT", stopChild);
process.off("SIGTERM", stopChild);

const traceSummary = trace.summarize();
emitEvidence("Trace", traceSummary);
emitEvidence("Shutdown", shutdownEvidence);

const passed = evaluateStage3B1RunOutcome({
  interrupted,
  failFastReason,
  traceSummary,
  shellReady,
  setupDialogReady,
  gpuCrashCount,
  childExitCode: childResult.code,
  shutdownPass: shutdownEvidence.pass,
  processCleanupPass: processCleanup.exited,
  mockRequestCount: mockSummary.requestCount,
  mockInvalidRequestCount: mockSummary.invalidRequestCount,
  privacyPass: privacyAudit.pass === true,
  cleanupPass: cleanupRemoved,
});

const final = {
  pass: passed,
  interrupted,
  failFastReason,
  shellReady,
  setupDialogReady,
  gpuCrashCount,
  elapsedMs: Date.now() - startedAt,
  childExitCode: childResult.code,
  nodesPass: [traceSummary.firstNodePass, traceSummary.secondNodePass],
  failure: traceSummary.failure,
  diagnostics: traceSummary.diagnostics,
};
emitEvidence("Final", final);
if (!passed && traceSummary.failure) {
  process.stdout.write("\n[B1 预演] 未通过。低敏诊断（processMatch/localVerdict/localReason）见上方 [B1:Final]。\n");
  process.stdout.write("[B1 预演] 按 docs/11 6.2，本场记为未完成，修复后重跑本预演，不进入 B2。\n");
}
process.exitCode = passed ? 0 : interrupted ? 130 : 1;
