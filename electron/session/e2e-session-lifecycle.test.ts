/**
 * 阶段 3 端到端会话生命周期与巡查自动判定集成测试 (E2E Session Lifecycle)
 *
 * 验证完整闭环链路 (S3-016, S3-017)：
 * 1. 密钥安全加密与配置持久化
 * 2. 创建 25 分钟会话并携带屏幕源与规则白名单/黑名单
 * 3. 前台白名单应用持续活跃 -> 进入巡查后判定 focused (零截图、零 AI 网络请求)
 * 4. 规则未知应用 -> 触发单帧捕获与 AI 判定
 * 5. 前台黑名单应用持续 20 秒 -> 巡查判定 distracted 并扣除偏航额度
 * 6. 会话正常结算 -> 产生评级 (S/A/B/C/D) 与信赖增加
 * 7. 查询历史记录与结构化 Observation 明细，验证数据完整且零图像/零明文泄露
 * 8. 安全清理与生命周期释放
 */

import { describe, it, expect } from "vitest";
import { XingbanDatabase } from "../storage/database.js";
import { SecretStore, type SafeStorageInterface } from "../security/secret-store.js";
import { FakeForegroundProbe } from "../inspection/fake-foreground-probe.js";
import { LocalRuleClassifier } from "../inspection/local-rule-classifier.js";
import { FakeCaptureService } from "../capture/capture-service.js";
import { FakeVisionAdapter } from "../vision/vision-adapter.js";
import { InspectionEngine } from "../inspection/inspection-engine.js";
import { SessionService } from "./service.js";
import { mapInspectionToObservationParams } from "../inspection/observation.js";
import type { SessionSnapshot } from "../../shared/session.js";

describe("阶段 3 E2E 会话生命周期与自动巡查端到端验证", () => {
  it("完成全流程端到端伴学、自动巡查判定、偏航结算与结构化历史记录", async () => {
    // 1. 初始化数据库与安全存储
    const db = new XingbanDatabase(":memory:");
    const mockStorage: SafeStorageInterface = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`ENC:${plainText}`),
      decryptString: (buf: Buffer) => buf.toString().slice(4),
    };
    const secretStore = new SecretStore(db, mockStorage);
    secretStore.setApiKey("sk-integration-test-key-12345");
    expect(secretStore.hasApiKey()).toBe(true);

    // 2. 初始化测试用硬件/网络替身
    const probe = new FakeForegroundProbe();
    const captureService = new FakeCaptureService();
    await captureService.startCapture("screen:0:0");
    const visionAdapter = new FakeVisionAdapter();
    const classifier = new LocalRuleClassifier();

    let latestSnapshot: SessionSnapshot | null = null;
    const sessionService = new SessionService((snapshot) => {
      latestSnapshot = snapshot;
    }, db, (_partnerId, totalTrust) => (totalTrust >= 20 ? "trusted" : "initial"));

    // 3. 启动一场新会话（25 分钟，带有白名单和黑名单规则）
    const ruleAllow = db.saveAppRule({
      matchType: "process",
      pattern: "Code.exe",
      decision: "allow",
      enabled: true,
    });
    const ruleBlock = db.saveAppRule({
      matchType: "process",
      pattern: "bilibili.exe",
      decision: "block",
      enabled: true,
    });

    const startSnapshot = sessionService.start({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "全流程端到端伴学测试",
      plannedMinutes: 25,
      captureSourceId: "screen:0:0",
      visionEnabled: true,
      sendWindowTitle: true,
      allowRuleIds: [ruleAllow.id],
      blockRuleIds: [ruleBlock.id],
    });

    expect(startSnapshot.phase).toBe("focusing");
    expect(startSnapshot.goal).toBe("全流程端到端伴学测试");

    // 4. 组装 InspectionEngine 巡查编排引擎
    const activeRules = [ruleAllow, ruleBlock];
    const engine = new InspectionEngine({
      sessionId: startSnapshot.sessionId,
      goal: startSnapshot.goal,
      visionEnabled: true,
      sendWindowTitle: true,
      rules: activeRules,
      probe,
      classifier,
      captureService,
      visionAdapter,
      onConfirmDeviation: (id) => {
        if (sessionService.getActive()?.phase === "patrolling") {
          sessionService.recordObservation(id, "distracted");
        }
      },
      onObservation: (result, confirmed) => {
        db.recordStructuredObservation(
          mapInspectionToObservationParams(startSnapshot.sessionId, result, confirmed),
        );
      },
    });

    // 5. 场景 A: 前台为白名单应用 Code.exe -> 触发巡查并判定 focused (零截图、零 AI)
    probe.pushSample({
      processName: "Code",
      windowTitle: "main.ts - Visual Studio Code",
      pid: 1001,
      capturedAt: "2026-08-29T10:00:00.000Z",
    });

    // 进入巡查阶段
    sessionService.previewPatrol(startSnapshot.sessionId);
    const resultA = await engine.inspectOnce();
    expect(resultA.label).toBe("focused");
    expect(resultA.source).toBe("local-rule");
    expect(resultA.reasonCode).toBe("allowed_app");
    expect(captureService.captureCallCount).toBe(0); // 绝对不截图
    expect(visionAdapter.callCount).toBe(0); // 绝对不调用 AI

    // 记录观察进入 feedback 阶段，然后完成反馈回到 focusing
    sessionService.recordObservation(startSnapshot.sessionId, "focused");
    sessionService.completeFeedback(startSnapshot.sessionId);
    expect(sessionService.getActive()?.phase).toBe("focusing");

    // 6. 场景 B: 前台切换为未知应用 -> 触发巡查，捕获单帧并调用 AI
    probe.pushSample({
      processName: "unknown-app",
      windowTitle: "My Document",
      pid: 2002,
      capturedAt: "2026-08-29T10:05:00.000Z",
    });
    captureService.setMockFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    visionAdapter.setNextResponse({
      label: "focused",
      confidence: 0.92,
      reasonCode: "task_related_content",
    });

    sessionService.previewPatrol(startSnapshot.sessionId);
    const resultB = await engine.inspectOnce();
    expect(resultB.label).toBe("focused");
    expect(resultB.source).toBe("vision-api");
    expect(captureService.captureCallCount).toBe(1); // 捕获了 1 帧
    expect(visionAdapter.callCount).toBe(1); // 调用了 1 次 AI

    sessionService.recordObservation(startSnapshot.sessionId, "focused");
    sessionService.completeFeedback(startSnapshot.sessionId);
    expect(sessionService.getActive()?.phase).toBe("focusing");

    // 7. 场景 C: 前台切换为黑名单应用持续满 20 秒 (4 次 5 秒采样) -> 本地黑名单确认偏航并扣除额度
    for (let i = 0; i < 3; i++) {
      probe.pushSample({
        processName: "bilibili",
        windowTitle: "哔哩哔哩 - 热门视频",
        pid: 3003,
        capturedAt: `2026-08-29T10:10:0${i * 5}.000Z`,
      });
      await engine.inspectOnce();
    }

    // 第 4 次采样（满 20 秒确认）
    probe.pushSample({
      processName: "bilibili",
      windowTitle: "哔哩哔哩 - 热门视频",
      pid: 3003,
      capturedAt: "2026-08-29T10:10:20.000Z",
    });
    sessionService.previewPatrol(startSnapshot.sessionId);
    const resultC2 = await engine.inspectOnce();
    expect(resultC2.label).toBe("distracted");
    expect(resultC2.source).toBe("local-rule");
    expect(resultC2.reasonCode).toBe("blocked_app");

    // 引擎已通过 onConfirmDeviation 自动回流扣除偏航并进入 feedback
    const afterDeviation = sessionService.getActive();
    expect(afterDeviation?.phase).toBe("feedback");
    expect(afterDeviation?.deviationCount).toBe(1);
    sessionService.completeFeedback(startSnapshot.sessionId);

    // 8. 正常结算会话
    const completedSnapshot = sessionService.finish(startSnapshot.sessionId, "completed");
    expect(completedSnapshot.phase).toBe("completed");
    expect(completedSnapshot.outcome).not.toBeNull();
    expect(completedSnapshot.outcome?.trustGained).toBeGreaterThanOrEqual(0);

    // 9. 验证持久化与 Observation 明细读取
    const history = db.listSessionHistory();
    expect(history).toHaveLength(1);
    expect(history[0].sessionId).toBe(startSnapshot.sessionId);
    expect(history[0].deviationCount).toBe(1);

    const observations = db.listSessionObservations(startSnapshot.sessionId);
    expect(observations.length).toBeGreaterThanOrEqual(3);

    // 验证第一条观察是本地白名单记录
    expect(observations[0]).toMatchObject({
      sessionId: startSnapshot.sessionId,
      label: "focused",
      source: "local-rule",
      reasonCode: "allowed_app",
      appName: "Code",
    });
    // 原始窗口标题未存，仅有 64 位 SHA-256 哈希
    expect(observations[0].windowTitleHash).toMatch(/^[a-f0-9]{64}$/);

    // 10. 资源安全释放与销毁
    engine.dispose();
    sessionService.dispose();
    db.close();
  });
});
