/**
 * WindowsForegroundProbe 自动化测试
 *
 * 覆盖：
 * - 可执行文件不存在时的安全降级 (unavailable)
 * - 真实 Windows 前台探针 (exe) 启动、单次采样与生命周期测试
 * - 内部流式数据处理：合法 JSON、超长行丢弃、畸形 JSON 丢弃
 * - 崩溃自动重启限制 (最多 1 次) 与 unavailable 状态沉淀
 * - 主动停止清理与不重启动作
 */

import { describe, it, expect } from "vitest";
import { EventEmitter } from "node:events";
import * as path from "node:path";
import * as fs from "node:fs";
import { WindowsForegroundProbe } from "./windows-foreground-probe.js";
import type { ForegroundProbeStatus, ForegroundSample } from "../../shared/inspection.js";

const realExePath = path.resolve(process.cwd(), "resources", "bin", "windows-foreground-probe.exe");
const hasRealExe = fs.existsSync(realExePath);
const runRealProbeTest = hasRealExe && process.env.XINGBAN_REAL_PROBE_TEST === "1";

describe("WindowsForegroundProbe", () => {
  it("可执行文件不存在时安全降级为 unavailable 且不抛出异常", async () => {
    const probe = new WindowsForegroundProbe({
      executablePath: "C:\\non_existent_probe_path_12345.exe",
    });

    const statuses: ForegroundProbeStatus[] = [];
    probe.onStatusChange((s) => statuses.push(s));

    probe.start(() => {});
    expect(probe.getStatus()).toBe("unavailable");
    expect(statuses).toEqual(["unavailable"]);
    expect(await probe.stopAndWait()).toBe(true);
  });

  it.skipIf(!runRealProbeTest)("真实 sidecar 正常启动并接收至少一个前台样本", async () => {
    const probe = new WindowsForegroundProbe({
      executablePath: realExePath,
      intervalMs: 1000,
    });

    const sample = await new Promise<ForegroundSample>((resolve, reject) => {
      const timer = setTimeout(() => {
        probe.stop();
        reject(new Error("等待真实探针样本超时 (6000ms)"));
      }, 6000);

      probe.start((s) => {
        clearTimeout(timer);
        resolve(s);
      });
    });

    expect(sample).toBeDefined();
    expect(typeof sample.capturedAt).toBe("string");
    expect(typeof sample.processName).toBe("string");
    expect(typeof sample.windowTitle).toBe("string");
    expect(typeof sample.pid).toBe("number");
    expect(probe.getStatus()).toBe("running");

    expect(await probe.stopAndWait()).toBe(true);
    expect(probe.getStatus()).toBe("stopped");
  });

  it("过滤超长行与畸形 JSON，不发生崩溃", () => {
    const validSample: ForegroundSample = {
      capturedAt: "2026-08-29T08:00:00.000Z",
      processName: "notepad",
      windowTitle: "notes.txt",
      pid: 5678,
    };

    const longGarbage = "A".repeat(5000);

    const probe = new WindowsForegroundProbe({
      executablePath: "dummy",
      maxLineLength: 1000, // 限制 1000 字符
    });

    const samples: ForegroundSample[] = [];
    (probe as unknown as { sampleListeners: ((s: ForegroundSample) => void)[] }).sampleListeners = [
      (s) => samples.push(s),
    ];

    const handleStdout = (probe as unknown as { handleStdoutData: (data: string) => void }).handleStdoutData.bind(probe);

    // 注入超长行、畸形 JSON 和合法样本
    handleStdout(`${longGarbage}\n`);
    handleStdout("{invalid_json\n");
    handleStdout(`${JSON.stringify(validSample)}\n`);

    expect(samples).toHaveLength(1);
    expect(samples[0]!.processName).toBe("notepad");
    expect(probe.getLatest()?.windowTitle).toBe("notes.txt");
  });

  it("子进程意外退出时最多自动重启 1 次，再次退出沉淀为 unavailable", async () => {
    const probe = new WindowsForegroundProbe({
      executablePath: "dummy",
      maxRestartCount: 1,
      restartDelayMs: 10,
    });

    const statuses: ForegroundProbeStatus[] = [];
    probe.onStatusChange((s) => statuses.push(s));

    const handleExit = (probe as unknown as { handleProcessExit: (code: number) => void }).handleProcessExit.bind(probe);

    // 模拟第一次异常退出
    handleExit(1);
    expect(probe.getStatus()).toBe("restarting");

    // 等待重启触发后，模拟第二次异常退出
    await new Promise((r) => setTimeout(r, 30));
    handleExit(1);
    expect(probe.getStatus()).toBe("unavailable");

    // 验证状态轨迹
    expect(statuses).toEqual(["restarting", "unavailable"]);

    probe.stop();
    expect(probe.getStatus()).toBe("stopped");
  });

  it("主动 stop() 时不触发重启且状态变为 stopped", () => {
    const probe = new WindowsForegroundProbe({
      executablePath: "dummy",
      maxRestartCount: 1,
    });

    const statuses: ForegroundProbeStatus[] = [];
    probe.onStatusChange((s) => statuses.push(s));

    probe.stop();
    expect(probe.getStatus()).toBe("stopped");

    // stop 之后触发的 exit 应该保持 stopped，不再重启
    const handleExit = (probe as unknown as { handleProcessExit: (code: number) => void }).handleProcessExit.bind(probe);
    handleExit(0);
    expect(probe.getStatus()).toBe("stopped");
  });

  it("stopAndWait 等待 sidecar 的真实 exit 事件", async () => {
    const probe = new WindowsForegroundProbe({ executablePath: "dummy" });
    const child = new EventEmitter() as EventEmitter & {
      exitCode: number | null;
      signalCode: NodeJS.Signals | null;
      stdin: { end: () => void };
      kill: () => boolean;
    };
    child.exitCode = null;
    child.signalCode = null;
    child.stdin = { end: () => {} };
    child.kill = () => {
      queueMicrotask(() => {
        child.signalCode = "SIGTERM";
        child.emit("exit", null, "SIGTERM");
      });
      return true;
    };
    (probe as unknown as { childProcess: typeof child }).childProcess = child;

    await expect(probe.stopAndWait(100)).resolves.toBe(true);
    expect(probe.getStatus()).toBe("stopped");
  });
});
