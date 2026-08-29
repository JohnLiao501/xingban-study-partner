/**
 * InspectionEngine 巡查编排引擎单元测试
 *
 * 核心验证：
 * - 本地白名单命中：不截图、不请求 AI，直接 focused
 * - 本地黑名单连续满 20 秒：确认 distracted 并扣减偏航
 * - 规则未知未授权：安全降级 uncertain
 * - 规则未知截图失败/超时：降级 uncertain
 * - AI focused (>= 0.70) 采纳，低于 0.70 降级 uncertain
 * - AI distracted (>= 0.80) 触发 15 秒二次独立确认流程，初次不扣偏航
 * - 15 秒新帧二次确认成功：确认偏航并记录
 * - 15 秒期间应用切换：取消二次确认，不处罚
 * - 15 秒期间停止共享：取消二次确认，不处罚
 * - 第二次确认失败或矛盾：降级 uncertain，不处罚
 * - AI 接口异常 (超时/500)：降级 uncertain，不处罚
 * - 隐私：标题哈希化，无原始标题与图像残留
 */

import { describe, it, expect, beforeEach } from "vitest";
import { InspectionEngine } from "./inspection-engine.js";
import { LocalRuleClassifier } from "./local-rule-classifier.js";
import { FakeForegroundProbe, createSample } from "./fake-foreground-probe.js";
import { FakeCaptureService } from "../capture/capture-service.js";
import { FakeVisionAdapter } from "../vision/vision-adapter.js";
import type { AppRule } from "../../shared/rules.js";
import type { InspectionResult } from "../../shared/inspection.js";

describe("InspectionEngine", () => {
  let probe: FakeForegroundProbe;
  let classifier: LocalRuleClassifier;
  let captureService: FakeCaptureService;
  let visionAdapter: FakeVisionAdapter;
  let confirmedDeviations: string[];
  let observations: { result: InspectionResult; confirmed: boolean }[];

  const dummyRules: AppRule[] = [
    {
      id: "rule-allow-code",
      matchType: "process",
      pattern: "code",
      decision: "allow",
      enabled: true,
      createdAt: new Date().toISOString(),
    },
    {
      id: "rule-block-game",
      matchType: "process",
      pattern: "game",
      decision: "block",
      enabled: true,
      createdAt: new Date().toISOString(),
    },
  ];

  beforeEach(() => {
    probe = new FakeForegroundProbe();
    classifier = new LocalRuleClassifier();
    captureService = new FakeCaptureService();
    visionAdapter = new FakeVisionAdapter();
    confirmedDeviations = [];
    observations = [];
  });

  function createEngine(overrides: Partial<Parameters<typeof InspectionEngine.prototype.constructor>[0]> = {}) {
    return new InspectionEngine({
      sessionId: "session-test-1",
      goal: "学习 TypeScript 高级编程",
      visionEnabled: true,
      sendWindowTitle: false,
      rules: dummyRules,
      probe,
      classifier,
      captureService,
      visionAdapter,
      confirmationDelayMs: 30, // 测试使用 30ms 加速时钟
      onConfirmDeviation: (id) => confirmedDeviations.push(id),
      onObservation: (result, confirmed) => observations.push({ result, confirmed }),
      ...overrides,
    });
  }

  it("前台命中持续 allow 规则：直接判定 focused，不截图、不调用 AI", async () => {
    const engine = createEngine();
    probe.pushSample(createSample("code", "study.ts"));
    captureService.setMockFrame(new Uint8Array([1, 2, 3]));

    const result = await engine.inspectOnce();

    expect(result.label).toBe("focused");
    expect(result.source).toBe("local-rule");
    expect(result.reasonCode).toBe("allowed_app");
    expect(visionAdapter.callCount).toBe(0); // 绝对不调用 AI
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("前台命中 block 规则累计满 20 秒：直接确认 distracted 并触发偏航扣减", async () => {
    const engine = createEngine();
    probe.pushSample(createSample("game", "Genshin Impact"));

    // 每次 5 秒，前 3 次（15 秒）不足 20 秒
    for (let i = 0; i < 3; i++) {
      const res = await engine.inspectOnce();
      expect(res.label).toBe("uncertain"); // 本地不足 20 秒且未开启 AI 判定时降级
      expect(confirmedDeviations).toHaveLength(0);
    }

    // 第 4 次（累加满 20 秒）
    const finalRes = await engine.inspectOnce();
    expect(finalRes.label).toBe("distracted");
    expect(finalRes.source).toBe("local-rule");
    expect(finalRes.reasonCode).toBe("blocked_app");
    expect(confirmedDeviations).toEqual(["session-test-1"]);
    expect(visionAdapter.callCount).toBe(0);
  });

  it("规则未知且未开启屏幕捕获：安全降级为 uncertain，不扣偏航", async () => {
    const engine = createEngine({ visionEnabled: false });
    probe.pushSample(createSample("chrome", "Browser"));

    const result = await engine.inspectOnce();
    expect(result.label).toBe("uncertain");
    expect(result.source).toBe("fallback");
    expect(confirmedDeviations).toHaveLength(0);
    expect(visionAdapter.callCount).toBe(0);
  });

  it("规则未知且捕获流未就绪：安全降级为 uncertain (capture_unavailable)", async () => {
    const engine = createEngine({ visionEnabled: true });
    // captureService 状态默认为 inactive
    probe.pushSample(createSample("chrome", "Browser"));

    const result = await engine.inspectOnce();
    expect(result.label).toBe("uncertain");
    expect(result.reasonCode).toBe("capture_unavailable");
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("规则未知且单帧 AI 判定为 focused (>= 0.70)：采纳为 focused", async () => {
    const engine = createEngine();
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("chrome", "Vue Docs"));

    visionAdapter.setNextResponse({
      label: "focused",
      confidence: 0.85,
      reasonCode: "task_related_content",
    });

    const result = await engine.inspectOnce();
    expect(result.label).toBe("focused");
    expect(result.source).toBe("vision-api");
    expect(result.confidence).toBe(0.85);
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("单帧 AI focused 置信度不足 0.70：安全降级为 uncertain", async () => {
    const engine = createEngine();
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("chrome", "Ambiguous Page"));

    visionAdapter.setNextResponse({
      label: "focused",
      confidence: 0.65, // 低于 0.70 门槛
      reasonCode: "insufficient_evidence",
    });

    const result = await engine.inspectOnce();
    expect(result.label).toBe("uncertain");
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("初次 AI 判定 distracted：当次温和提醒不扣偏航，15秒后新帧二次确认后才确认偏航", async () => {
    const engine = createEngine({ confirmationDelayMs: 25 });
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("bilibili", "Video Player"));

    // 两次 AI 响应均返回高置信度 distracted
    visionAdapter.enqueueResponse({
      label: "distracted",
      confidence: 0.9,
      reasonCode: "entertainment_content",
    });
    visionAdapter.enqueueResponse({
      label: "distracted",
      confidence: 0.95,
      reasonCode: "entertainment_content",
    });

    // 第一次判定
    const firstPass = await engine.inspectOnce();
    expect(firstPass.label).toBe("uncertain"); // 初次不处罚！
    expect(confirmedDeviations).toHaveLength(0); // 绝对不增加偏航计数
    expect(engine.hasPendingConfirmation()).toBe(true);

    // 等待 15 秒（测试用 25ms 加速时钟）二次确认触发
    await new Promise((r) => setTimeout(r, 45));

    // 第二次判定执行后，正式确认偏航
    expect(confirmedDeviations).toEqual(["session-test-1"]);
    expect(engine.hasPendingConfirmation()).toBe(false);

    // 验证第二次产生了 confirmedDeviation = true 的记录
    const lastObs = observations[observations.length - 1];
    expect(lastObs?.result.label).toBe("distracted");
    expect(lastObs?.confirmed).toBe(true);
  });

  it("15 秒期间前台应用切换：取消二次确认任务且不处罚", async () => {
    const engine = createEngine({ confirmationDelayMs: 25 });
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("bilibili", "Video Player"));

    visionAdapter.setNextResponse({
      label: "distracted",
      confidence: 0.9,
      reasonCode: "entertainment_content",
    });

    await engine.inspectOnce();
    expect(engine.hasPendingConfirmation()).toBe(true);

    // 用户在等待期间切换回了 VS Code
    probe.pushSample(createSample("code", "study.ts"));

    await new Promise((r) => setTimeout(r, 45));

    // 二次确认自动放弃，不产生偏航扣减
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("15 秒期间用户停止屏幕共享：取消二次确认且不处罚", async () => {
    const engine = createEngine({ confirmationDelayMs: 25 });
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("bilibili", "Video Player"));

    visionAdapter.setNextResponse({
      label: "distracted",
      confidence: 0.9,
      reasonCode: "entertainment_content",
    });

    await engine.inspectOnce();
    expect(engine.hasPendingConfirmation()).toBe(true);

    // 用户主动停止共享
    await captureService.stopCapture();

    await new Promise((r) => setTimeout(r, 45));

    expect(confirmedDeviations).toHaveLength(0);
  });

  it("第二次确认 AI 结果矛盾或置信度不足：降级为 uncertain，不扣偏航", async () => {
    const engine = createEngine({ confirmationDelayMs: 25 });
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("bilibili", "Video Player"));

    // 第一次高置信度 distracted，第二次变成 uncertain
    visionAdapter.enqueueResponse({
      label: "distracted",
      confidence: 0.9,
      reasonCode: "entertainment_content",
    });
    visionAdapter.enqueueResponse({
      label: "uncertain",
      confidence: 0.5,
      reasonCode: "insufficient_evidence",
    });

    await engine.inspectOnce();
    await new Promise((r) => setTimeout(r, 45));

    expect(confirmedDeviations).toHaveLength(0); // 绝不扣偏航
  });

  it("AI 调用异常 (超时/500)：安全降级为 uncertain (api_unavailable)，不扣偏航", async () => {
    const engine = createEngine();
    await captureService.startCapture("screen:0:0");
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8]));
    probe.pushSample(createSample("chrome", "Browser"));

    visionAdapter.setFailure(new Error("VISION_TIMEOUT"));

    const result = await engine.inspectOnce();
    expect(result.label).toBe("uncertain");
    expect(result.reasonCode).toBe("api_unavailable");
    expect(confirmedDeviations).toHaveLength(0);
  });

  it("隐私保障：窗口标题不可逆哈希，观察记录中无原始标题", async () => {
    const engine = createEngine();
    probe.pushSample(createSample("code", "Confidential_Salary_Report.xlsx"));

    const result = await engine.inspectOnce();
    expect(result.windowTitleHash).toBeDefined();
    expect(result.windowTitleHash).not.toContain("Confidential");
    expect(result.windowTitleHash).toHaveLength(64); // 64 字符十六进制 SHA-256
  });
});
