import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { Stage3MockVisionServer } from "../dist-electron/electron/acceptance/mock-vision-server.js";
import { Stage3RunTrace } from "../dist-electron/electron/acceptance/stage3-run-trace.js";
import {
  auditStage3AcceptanceDirectory,
  evaluateStage3AcceptanceRunOutcome,
  readStage3AcceptanceDatabaseEvidence,
  removeStage3AcceptanceDirectory,
} from "../dist-electron/electron/acceptance/stage3-evidence.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceDirectory = await mkdtemp(path.join(os.tmpdir(), "xingban-stage3-acceptance-"));
const mockServer = new Stage3MockVisionServer();
let child = null;
let interrupted = false;
let terminationPromise = null;
let terminationTarget = null;
const runTrace = new Stage3RunTrace();
let shutdownEvidence = { seen: false, captureStopped: false, probeStopped: false, pass: false };

function emitEvidence(label, value) {
  process.stdout.write(`[Acceptance:Stage3:${label}] ${JSON.stringify(value)}\n`);
}

/**
 * 子进程环境必须剔除 `ELECTRON_RUN_AS_NODE`。若该变量存在，Electron 可执行文件
 * 会以纯 Node 运行：没有主进程、没有 `electron` 内建模块、没有窗口与 GPU 进程，
 * 表现为命名导入 SyntaxError 或莫名的 renderer/GPU `launch-failed`。
 * 这是 B0 定位到的根因，必须从环境层消除。
 */
function buildChildEnvironment(extra) {
  const environment = { ...process.env, ...extra };
  delete environment.ELECTRON_RUN_AS_NODE;
  return environment;
}

function waitForChildExit(target, timeoutMs) {
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

  if (process.platform === "win32" && target.pid) {
    await runTaskkill(target.pid);
  } else {
    try {
      target.kill("SIGKILL");
    } catch {
      // 由最终 exit 等待决定是否失败。
    }
  }
  return { exited: await waitForChildExit(target, 5_000), forced: true };
}

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

function acceptStdoutLine(line) {
  const eventPrefix = "[Acceptance:Stage3] ";
  const shutdownPrefix = "[Acceptance:Stage3:Shutdown] ";
  if (line.startsWith(eventPrefix)) {
    try {
      runTrace.accept(JSON.parse(line.slice(eventPrefix.length)));
    } catch {
      runTrace.accept(null);
    }
  } else if (line.startsWith(shutdownPrefix)) {
    try {
      const value = JSON.parse(line.slice(shutdownPrefix.length));
      shutdownEvidence = {
        seen: true,
        captureStopped: value?.captureStopped === true,
        probeStopped: value?.probeStopped === true,
        pass: value?.pass === true,
      };
    } catch {
      shutdownEvidence = { seen: true, captureStopped: false, probeStopped: false, pass: false };
    }
  }
}

process.once("SIGINT", stopChild);
process.once("SIGTERM", stopChild);

let childResult = { code: 1, signal: null };
let databaseEvidence = { pass: false };
let privacyAudit = { pass: false };
let cleanupRemoved = false;
let processCleanup = { exited: false, forced: false };
let mockSummary = {
  requestCount: 0,
  scenarioRequestCount: 0,
  consumedSteps: 0,
  remainingSteps: 5,
  invalidRequestCount: 0,
};

try {
  const mockBaseUrl = await mockServer.start();
  emitEvidence("Start", {
    isolatedUserData: true,
    loopbackMock: true,
    deterministicPatrols: true,
    plannedMinutes: 25,
  });

  child = spawn(electronPath, [projectRoot], {
    cwd: projectRoot,
      env: buildChildEnvironment({
        XINGBAN_STAGE3_ACCEPTANCE: "1",
        XINGBAN_STAGE3_B2_DISABLE_CONTENT_PROTECTION: "1",
        XINGBAN_ACCEPTANCE_USER_DATA: acceptanceDirectory,
        XINGBAN_ACCEPTANCE_MOCK_BASE_URL: mockBaseUrl,
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
  emitEvidence("RunnerError", {
    code: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN_RUNNER_ERROR",
    pass: false,
  });
} finally {
  processCleanup = await requestChildTermination();
  emitEvidence("Processes", { ...processCleanup, pass: processCleanup.exited });

  mockSummary = mockServer.getSummary();
  await mockServer.close().catch(() => {});
  emitEvidence("Mock", {
    ...mockSummary,
    pass: mockSummary.requestCount === 5 &&
      mockSummary.scenarioRequestCount === 5 &&
      mockSummary.remainingSteps === 0 &&
      mockSummary.invalidRequestCount === 0,
  });

  const traceSummary = runTrace.summarize();
  emitEvidence("Trace", traceSummary);
  emitEvidence("Shutdown", shutdownEvidence);

  if (processCleanup.exited) {
    try {
      databaseEvidence = readStage3AcceptanceDatabaseEvidence(
        path.join(acceptanceDirectory, "xingban.sqlite3"),
      );
    } catch {
      databaseEvidence = { pass: false };
    }
  }
  emitEvidence("Database", databaseEvidence);

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

const traceSummary = runTrace.summarize();

const passed = evaluateStage3AcceptanceRunOutcome({
  childExitCode: childResult.code,
  interrupted,
  databasePass: databaseEvidence.pass,
  privacyPass: privacyAudit.pass,
  cleanupPass: cleanupRemoved,
  processCleanupPass: processCleanup.exited,
  tracePass: traceSummary.pass && shutdownEvidence.pass,
  mockRequestCount: mockSummary.requestCount,
  mockScenarioRequestCount: mockSummary.scenarioRequestCount,
  mockRemainingSteps: mockSummary.remainingSteps,
  mockInvalidRequestCount: mockSummary.invalidRequestCount,
});
emitEvidence("Final", {
  childExitCode: childResult.code,
  interrupted,
  processesExited: processCleanup.exited,
  tracePass: traceSummary.pass,
  shutdownPass: shutdownEvidence.pass,
  pass: passed,
});
process.exitCode = passed ? 0 : interrupted ? 130 : 1;
