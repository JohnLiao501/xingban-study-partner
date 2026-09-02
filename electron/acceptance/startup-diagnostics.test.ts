import { describe, expect, it } from "vitest";
import {
  Stage3StartupDiagnostics,
  parseStartupProbeResult,
  summarizeGpuInfo,
  type StartupDiagnosticsEvent,
  type StartupProbeView,
} from "./startup-diagnostics.js";

function probe(view: Partial<StartupProbeView>): string {
  return JSON.stringify({
    shell: false,
    dialog: false,
    bootError: false,
    startClicked: false,
    ...view,
  });
}

interface FakeWindowOptions {
  script?: (source: string) => unknown;
  destroyed?: boolean;
}

function createFakeWindow(options: FakeWindowOptions = {}) {
  const executions: string[] = [];
  const window = {
    isDestroyed: () => options.destroyed === true,
    webContents: {
      executeJavaScript: async (source: string) => {
        executions.push(source);
        return options.script ? options.script(source) : probe({});
      },
    },
  };
  return { window, executions };
}

function createHarness(window: unknown, options: { timeoutMs?: number; results?: unknown[] } = {}) {
  const events: StartupDiagnosticsEvent[] = [];
  let tick = 0;
  let clock = 0;
  const queue = [...(options.results ?? [])];
  const fake = {
    isDestroyed: () => (window as { isDestroyed?: () => boolean } | null)?.isDestroyed?.() ?? false,
    webContents: {
      executeJavaScript: async () => {
        const next = queue.shift();
        if (next instanceof Error) throw next;
        return next ?? probe({});
      },
    },
  };
  const diagnostics = new Stage3StartupDiagnostics(
    (event) => events.push(event),
    () => fake as never,
    {
      timeoutMs: options.timeoutMs ?? 5_000,
      intervalMs: 100,
      sleep: async () => {
        tick += 1;
        clock += 100;
      },
      now: () => clock,
    },
  );
  return { diagnostics, events, stats: () => ({ tick, clock }) };
}

describe("parseStartupProbeResult", () => {
  it("接受完整合法的探针结果", () => {
    expect(parseStartupProbeResult(probe({ shell: true, dialog: true, startClicked: true }))).toEqual({
      shellReady: true,
      dialogReady: true,
      bootError: false,
      startClicked: true,
    });
  });

  it("保留 bootError 且忽略额外字段", () => {
    const raw = JSON.stringify({ shell: true, dialog: false, bootError: true, extra: "x" });
    expect(parseStartupProbeResult(raw)?.bootError).toBe(true);
  });

  it("拒绝非字符串、超长、非法 JSON 与非对象", () => {
    expect(parseStartupProbeResult(null)).toBeNull();
    expect(parseStartupProbeResult(42)).toBeNull();
    expect(parseStartupProbeResult("x".repeat(600))).toBeNull();
    expect(parseStartupProbeResult("{not json")).toBeNull();
    expect(parseStartupProbeResult("[]")).toBeNull();
  });

  it("缺少布尔判据时返回 null", () => {
    expect(parseStartupProbeResult(JSON.stringify({ shell: true }))).toBeNull();
    expect(parseStartupProbeResult(JSON.stringify({ shell: "yes", dialog: false }))).toBeNull();
  });
});

describe("summarizeGpuInfo", () => {
  it("从 auxAttributes 提取并截断 glRenderer", () => {
    const result = summarizeGpuInfo({
      auxAttributes: { glRenderer: "r".repeat(300) },
    });
    expect(result.available).toBe(true);
    expect(result.glRenderer).toHaveLength(120);
  });

  it("缺少 GPU 信息时安全降级", () => {
    expect(summarizeGpuInfo(null)).toEqual({ stage: "gpu-info", available: false });
    expect(summarizeGpuInfo({ auxAttributes: {} })).toEqual({ stage: "gpu-info", available: false });
    expect(summarizeGpuInfo(["not", "an", "object"])).toEqual({
      stage: "gpu-info",
      available: false,
    });
  });
});

describe("Stage3StartupDiagnostics", () => {
  it("外壳与设置弹窗依次就绪时判定通过", async () => {
    const { diagnostics, events } = createHarness(null, {
      results: [probe({ shell: true, startClicked: true }), probe({ shell: true, dialog: true })],
    });
    const outcome = await diagnostics.run();
    expect(outcome.pass).toBe(true);
    expect(outcome.shellReady).toBe(true);
    expect(outcome.setupDialogReady).toBe(true);
    expect(events.map((event) => event.stage)).toEqual([
      "shell-ready",
      "setup-dialog-ready",
      "startup-complete",
    ]);
  });

  it("启动失败时输出 startup-failed 与最后错误", async () => {
    const { diagnostics, events } = createHarness(null, {
      results: [probe({ shell: true, bootError: true }), probe({ shell: true })],
      timeoutMs: 200,
    });
    const outcome = await diagnostics.run();
    expect(outcome.pass).toBe(false);
    expect(outcome.bootError).toBe(true);
    expect(events.at(-1)?.stage).toBe("startup-failed");
  });

  it("探针抛错时累计失败次数且不崩溃", async () => {
    const { diagnostics } = createHarness(null, {
      results: [new Error("RENDERER_LOST")],
      timeoutMs: 200,
    });
    const outcome = await diagnostics.run();
    expect(outcome.probeFailures).toBeGreaterThan(0);
    expect(outcome.lastError).toBe("RENDERER_LOST");
    expect(outcome.pass).toBe(false);
  });

  it("主窗口缺失时立即失败并记录原因", async () => {
    const events: StartupDiagnosticsEvent[] = [];
    const diagnostics = new Stage3StartupDiagnostics(
      (event) => events.push(event),
      () => undefined,
      { timeoutMs: 5_000, intervalMs: 10, sleep: async () => {}, now: () => 0 },
    );
    const outcome = await diagnostics.run();
    expect(outcome.pass).toBe(false);
    expect(outcome.lastError).toBe("MAIN_WINDOW_MISSING");
  });

  it("探针脚本引用应用外壳与设置弹窗选择器", async () => {
    const { window, executions } = createFakeWindow();
    let clock = 0;
    const diagnostics = new Stage3StartupDiagnostics(
      () => {},
      () => window as never,
      {
        timeoutMs: 200,
        intervalMs: 10,
        sleep: async () => {
          clock += 10;
        },
        now: () => clock,
      },
    );
    await diagnostics.run();
    expect(executions[0]).toContain(".app-shell");
    expect(executions[0]).toContain("session-setup-title");
  });
});
