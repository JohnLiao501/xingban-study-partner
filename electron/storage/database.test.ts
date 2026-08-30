import { describe, expect, it } from "vitest";
import { advanceSession, createSession } from "../../shared/session-engine";
import type { SessionSnapshot, StartSessionInput } from "../../shared/session";
import { XingbanDatabase } from "./database";

function focusingSession(
  sessionId: string,
  partnerId = "demo.guardian-zero",
): SessionSnapshot {
  const input: StartSessionInput = {
    partnerId,
    packVersion: "1.0.0",
    sceneId: "quiet-observatory",
    goal: `测试 ${sessionId}`,
    plannedMinutes: 25,
  };
  return advanceSession(
    createSession(input, { sessionId, seed: 42 }),
    { type: "prepared" },
  );
}

describe("XingbanDatabase", () => {
  it("saves and safely pauses a recoverable checkpoint", () => {
    const database = new XingbanDatabase(":memory:");
    const checkpoint = advanceSession(focusingSession("recover-me"), {
      type: "tick",
      seconds: 125,
    });
    database.saveSession(checkpoint);

    expect(database.loadRecoverableSession()).toMatchObject({
      sessionId: "recover-me",
      phase: "focusing",
      paused: true,
      focusedSeconds: 125,
      recoveredFromCheckpoint: true,
    });
    database.close();
  });

  it("finalizes trust exactly once even if settlement is retried", () => {
    const database = new XingbanDatabase(":memory:");
    const focusing = {
      ...focusingSession("settled-once"),
      focusedSeconds: 20 * 60,
      deviationCount: 1,
    };
    const settled = advanceSession(focusing, { type: "finish", mode: "completed" });
    const resolveLevel = (totalTrust: number) => totalTrust >= 20 ? "trusted" : "initial";

    const first = database.finalizeSession(settled, resolveLevel);
    const replay = database.finalizeSession(settled, resolveLevel);
    expect(first).toMatchObject({ totalTrust: 27, currentLevelId: "trusted" });
    expect(replay.totalTrust).toBe(27);
    database.close();
  });

  it("keeps progress isolated by partnerId", () => {
    const database = new XingbanDatabase(":memory:");
    const first = advanceSession({
      ...focusingSession("partner-a-session", "partner-a"),
      focusedSeconds: 10 * 60,
    }, { type: "finish", mode: "completed" });
    const second = advanceSession({
      ...focusingSession("partner-b-session", "partner-b"),
      focusedSeconds: 5 * 60,
    }, { type: "finish", mode: "completed" });

    database.finalizeSession(first, () => "level-a");
    database.finalizeSession(second, () => "level-b");
    expect(database.getPartnerProgress("partner-a").totalTrust).toBe(10);
    expect(database.getPartnerProgress("partner-b").totalTrust).toBe(5);
    database.close();
  });

  it("lists terminal sessions newest first with their structured result", () => {
    const database = new XingbanDatabase(":memory:");
    const completed = advanceSession({
      ...focusingSession("history-completed"),
      focusedSeconds: 25 * 60,
    }, { type: "finish", mode: "completed" });
    const interrupted = advanceSession({
      ...focusingSession("history-interrupted"),
      focusedSeconds: 3 * 60,
    }, { type: "finish", mode: "interrupted" });

    database.finalizeSession(completed, () => "trusted");
    database.finalizeSession(interrupted, () => "trusted");
    const history = database.listSessionHistory();
    expect(history).toHaveLength(2);
    expect(history.map((item) => item.sessionId)).toEqual([
      "history-interrupted",
      "history-completed",
    ]);
    expect(history[0]).toMatchObject({ grade: null, trustGained: 0, phase: "interrupted" });
    expect(history[1]).toMatchObject({ grade: "S", trustGained: 35, phase: "completed" });
    expect(database.loadRecoverableSession()).toBeNull();
    database.close();
  });

  it("creates, toggles, lists, and deletes local app rules", () => {
    const database = new XingbanDatabase(":memory:");
    const saved = database.saveAppRule({
      matchType: "process",
      pattern: "  Code.exe  ",
      decision: "allow",
      enabled: true,
    });
    expect(saved).toMatchObject({ pattern: "Code.exe", decision: "allow", enabled: true });

    database.saveAppRule({
      id: saved.id,
      matchType: saved.matchType,
      pattern: saved.pattern,
      decision: saved.decision,
      enabled: false,
    });
    expect(database.listAppRules()).toMatchObject([{ id: saved.id, enabled: false }]);
    database.deleteAppRule(saved.id);
    expect(database.listAppRules()).toEqual([]);
    database.close();
  });

  it("正确记录并查询会话的结构化 Observation 明细", () => {
    const database = new XingbanDatabase(":memory:");
    const sessionId = "session-with-obs";
    database.saveSession(focusingSession(sessionId));

    // 写入两条结构化观察
    database.recordStructuredObservation({
      sessionId,
      observedAt: "2026-08-29T10:00:00.000Z",
      label: "focused",
      confidence: 0.95,
      source: "local-rule",
      reasonCode: "allowed_app",
      appName: "Code",
      windowTitleHash: "hash-code-123456",
      confirmedDeviation: false,
    });

    database.recordStructuredObservation({
      sessionId,
      observedAt: "2026-08-29T10:15:00.000Z",
      label: "distracted",
      confidence: 0.88,
      source: "vision-api",
      reasonCode: "entertainment_content",
      appName: "bilibili",
      windowTitleHash: null,
      confirmedDeviation: true,
    });

    const records = database.listSessionObservations(sessionId);
    expect(records).toHaveLength(2);

    expect(records[0]).toMatchObject({
      sessionId,
      label: "focused",
      confidence: 0.95,
      source: "local-rule",
      reasonCode: "allowed_app",
      appName: "Code",
      windowTitleHash: "hash-code-123456",
      confirmedDeviation: false,
    });

    expect(records[1]).toMatchObject({
      sessionId,
      label: "distracted",
      confidence: 0.88,
      source: "vision-api",
      reasonCode: "entertainment_content",
      appName: "bilibili",
      windowTitleHash: null,
      confirmedDeviation: true,
    });

    database.close();
  });

  it("manages installed partner packs and active partner selection", () => {
    const database = new XingbanDatabase(":memory:");

    // 初始状态下无已安装包，活跃伙伴为空
    expect(database.listInstalledPacks()).toEqual([]);
    expect(database.getActivePartnerId()).toBeNull();

    // 记录安装伙伴包
    database.saveInstalledPack({
      partnerId: "test.companion-two",
      packVersion: "1.0.0",
      displayName: "测试伙伴乙",
      sourceType: "original",
      distribution: "redistributable",
      installPath: "C:\\mock\\partners\\test.companion-two\\1.0.0",
      manifestHash: "abc123456",
      enabled: true,
      installedAt: "2026-08-29T10:00:00.000Z",
    });

    const list = database.listInstalledPacks();
    expect(list).toHaveLength(1);
    expect(list[0].partnerId).toBe("test.companion-two");
    expect(list[0].displayName).toBe("测试伙伴乙");

    // 设置与获取活跃伙伴
    database.setActivePartnerId("test.companion-two");
    expect(database.getActivePartnerId()).toBe("test.companion-two");

    // 删除伙伴包
    database.deleteInstalledPack("test.companion-two", "1.0.0");
    expect(database.listInstalledPacks()).toHaveLength(0);

    database.close();
  });
});
