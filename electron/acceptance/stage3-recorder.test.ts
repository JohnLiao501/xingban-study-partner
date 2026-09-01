import { describe, expect, it } from "vitest";
import { advanceSession, createSession } from "../../shared/session-engine.js";
import { Stage3AcceptanceRecorder, type Stage3AcceptanceEvent } from "./stage3-recorder.js";

describe("stage 3 acceptance recorder", () => {
  it("emits only low-sensitivity allowlisted fields", () => {
    const events: Stage3AcceptanceEvent[] = [];
    const recorder = new Stage3AcceptanceRecorder(
      (event) => events.push(event),
      { allowProcessName: "notepad", blockProcessName: "mspaint" },
    );
    const snapshot = advanceSession(createSession({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "完整目标不应进入摘要",
      plannedMinutes: 25,
    }, { sessionId: "secret-session-id", seed: 42 }), { type: "prepared" });

    recorder.recordSnapshot(snapshot);
    recorder.recordLocalClassification("sensitive-app", {
      verdict: "unknown",
      reason: "no_match",
    });
    recorder.recordObservation({
      label: "uncertain",
      confidence: 0.9,
      reasonCode: "private_communication",
      source: "vision-api",
      appName: "sensitive-app",
      windowTitleHash: "abc",
      latencyMs: 12,
      errorCode: null,
    }, false);

    const serialized = JSON.stringify(events);
    expect(serialized).not.toContain("完整目标");
    expect(serialized).not.toContain("secret-session-id");
    expect(serialized).not.toContain("sensitive-app");
    expect(serialized).not.toContain("abc");
    expect(serialized).toContain("private_communication");
    expect(events[1]).toMatchObject({
      kind: "classification",
      processMatch: "other",
      localVerdict: "unknown",
      localReason: "no_match",
    });
  });

  it("maps acceptance process names without emitting raw names", () => {
    const events: Stage3AcceptanceEvent[] = [];
    const recorder = new Stage3AcceptanceRecorder(
      (event) => events.push(event),
      { allowProcessName: "notepad", blockProcessName: "mspaint" },
    );

    recorder.recordLocalClassification("MSPAINT.EXE", {
      verdict: "unknown",
      reason: "block_duration_insufficient",
    });

    expect(events[0]).toMatchObject({
      kind: "classification",
      processMatch: "block",
      localVerdict: "unknown",
      localReason: "block_duration_insufficient",
    });
    expect(JSON.stringify(events)).not.toContain("MSPAINT");
  });
});
