/**
 * ForegroundProbe 接口与 FakeForegroundProbe 测试
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  FakeForegroundProbe,
  createSample,
} from "./fake-foreground-probe.js";

describe("FakeForegroundProbe", () => {
  let probe: FakeForegroundProbe;

  beforeEach(() => {
    probe = new FakeForegroundProbe();
  });

  it("初始状态为 stopped，无最新样本", () => {
    expect(probe.getStatus()).toBe("stopped");
    expect(probe.getLatest()).toBeNull();
  });

  it("start 后状态变为 running", () => {
    const statuses: string[] = [];
    probe.onStatusChange((s) => statuses.push(s));
    probe.start(() => {});
    expect(probe.getStatus()).toBe("running");
    expect(statuses).toEqual(["running"]);
  });

  it("pushSample 触发监听器并更新 latest", () => {
    const received: unknown[] = [];
    probe.start((s) => received.push(s));
    const sample = createSample("code", "study.ts");
    probe.pushSample(sample);
    expect(probe.getLatest()).toEqual(sample);
    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(sample);
  });

  it("stop 后状态变为 stopped", () => {
    probe.start(() => {});
    probe.stop();
    expect(probe.getStatus()).toBe("stopped");
  });

  it("模拟崩溃和恢复状态变化", () => {
    const statuses: string[] = [];
    probe.onStatusChange((s) => statuses.push(s));
    probe.start(() => {});
    probe.setStatus("unavailable");
    probe.setStatus("restarting");
    probe.setStatus("running");
    expect(statuses).toEqual(["running", "unavailable", "restarting", "running"]);
  });

  it("clearLatest 清空最新样本", () => {
    probe.start(() => {});
    probe.pushSample(createSample("notepad"));
    expect(probe.getLatest()).not.toBeNull();
    probe.clearLatest();
    expect(probe.getLatest()).toBeNull();
  });

  it("取消 onStatusChange 监听后不再收到回调", () => {
    const statuses: string[] = [];
    const unsub = probe.onStatusChange((s) => statuses.push(s));
    probe.start(() => {});
    unsub();
    probe.setStatus("unavailable");
    expect(statuses).toEqual(["running"]);
  });
});

describe("createSample 辅助函数", () => {
  it("生成有效的 ForegroundSample", () => {
    const sample = createSample("code", "study.ts", 5678);
    expect(sample.processName).toBe("code");
    expect(sample.windowTitle).toBe("study.ts");
    expect(sample.pid).toBe(5678);
    expect(sample.capturedAt).toBeTruthy();
  });

  it("使用默认值", () => {
    const sample = createSample("notepad");
    expect(sample.windowTitle).toBe("");
    expect(sample.pid).toBe(1234);
  });
});
