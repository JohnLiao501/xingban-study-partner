import { describe, expect, it } from "vitest";
import type { Stage3AcceptanceEvent } from "./stage3-recorder.js";
import { evaluateStage3B1RunOutcome, Stage3B1RunTrace } from "./stage3-b1-trace.js";

function event(
  overrides: Partial<Stage3AcceptanceEvent> = {},
): Stage3AcceptanceEvent {
  return {
    kind: "snapshot",
    focusedSecond: 0,
    phase: "focusing",
    paused: false,
    label: null,
    reasonCode: null,
    source: null,
    deviationCount: 0,
    patrolCount: 0,
    captureStatus: "inactive",
    confirmedDeviation: false,
    processMatch: null,
    localVerdict: null,
    localReason: null,
    pass: true,
    ...overrides,
  };
}

function allowedNode(focusedSecond = 120): Stage3AcceptanceEvent {
  return event({
    kind: "observation",
    focusedSecond,
    label: "focused",
    reasonCode: "allowed_app",
    source: "local-rule",
    confirmedDeviation: false,
    deviationCount: 0,
    patrolCount: 1,
  });
}

function blockedNode(focusedSecond = 180): Stage3AcceptanceEvent {
  return event({
    kind: "observation",
    focusedSecond,
    label: "distracted",
    reasonCode: "blocked_app",
    source: "local-rule",
    confirmedDeviation: true,
    deviationCount: 1,
    patrolCount: 2,
  });
}

describe("stage 3 B1 rehearsal trace", () => {
  it("passes when the 2:00 allow node and the 3:00 block node both match", () => {
    const trace = new Stage3B1RunTrace();
    expect(trace.accept(event({ kind: "capture", captureStatus: "active" }))).toBe("continue");
    expect(trace.accept(event({
      kind: "classification",
      focusedSecond: 60,
      processMatch: "allow",
      localVerdict: "focused",
      localReason: "allowed_app",
    }))).toBe("continue");
    expect(trace.accept(allowedNode())).toBe("continue");
    expect(trace.accept(blockedNode())).toBe("stop-pass");

    const summary = trace.summarize();
    expect(summary).toMatchObject({
      observationCount: 2,
      invalidEventCount: 0,
      firstNodePass: true,
      secondNodePass: true,
      failure: null,
      pass: true,
    });
  });

  it("stops immediately when the 2:00 node is not the allow-rule verdict", () => {
    const trace = new Stage3B1RunTrace();
    expect(trace.accept(event({
      kind: "observation",
      focusedSecond: 120,
      label: "uncertain",
      reasonCode: "insufficient_evidence",
      source: "fallback",
      confirmedDeviation: false,
      patrolCount: 1,
    }))).toBe("stop-fail");

    const summary = trace.summarize();
    expect(summary.firstNodePass).toBe(false);
    expect(summary.pass).toBe(false);
    expect(summary.failure).toMatchObject({ reason: "observation_mismatch", node: "2:00" });
  });

  it("fails fast when the 3:00 node stays unconfirmed and keeps diagnostics", () => {
    const trace = new Stage3B1RunTrace();
    trace.accept(allowedNode());
    trace.accept(event({
      kind: "classification",
      focusedSecond: 175,
      processMatch: "block",
      localVerdict: "unknown",
      localReason: "block_duration_insufficient",
    }));
    expect(trace.accept(event({
      kind: "observation",
      focusedSecond: 180,
      label: "uncertain",
      reasonCode: "insufficient_evidence",
      source: "fallback",
      confirmedDeviation: false,
      deviationCount: 0,
      patrolCount: 2,
    }))).toBe("stop-fail");

    const summary = trace.summarize();
    expect(summary.firstNodePass).toBe(true);
    expect(summary.secondNodePass).toBe(false);
    expect(summary.pass).toBe(false);
    expect(summary.failure).toMatchObject({ reason: "observation_mismatch", node: "3:00" });
    expect(summary.diagnostics.at(-1)).toMatchObject({
      processMatch: "block",
      localVerdict: "unknown",
      localReason: "block_duration_insufficient",
    });
  });

  it("rejects nodes outside the patrol scheduling window", () => {
    const trace = new Stage3B1RunTrace();
    trace.accept(allowedNode());
    expect(trace.accept(blockedNode(200))).toBe("stop-fail");
    expect(trace.summarize().failure).toMatchObject({ node: "3:00", reason: "observation_mismatch" });
  });

  it("fails fast on malformed events", () => {
    const trace = new Stage3B1RunTrace();
    expect(trace.accept({ kind: "observation", extra: "not allowed" })).toBe("stop-fail");
    const summary = trace.summarize();
    expect(summary.invalidEventCount).toBe(1);
    expect(summary.pass).toBe(false);
    expect(summary.failure).toMatchObject({ reason: "invalid_event" });
  });

  it("locks the verdict after two observations and ignores late events", () => {
    const trace = new Stage3B1RunTrace();
    trace.accept(allowedNode());
    trace.accept(blockedNode());
    expect(trace.accept(allowedNode(300))).toBe("stop-pass");
    expect(trace.summarize()).toMatchObject({ observationCount: 2, pass: true });
  });

  it("keeps only the most recent classification diagnostics", () => {
    const trace = new Stage3B1RunTrace();
    for (let index = 0; index < 12; index += 1) {
      trace.accept(event({
        kind: "classification",
        focusedSecond: index,
        processMatch: "other",
        localVerdict: "unknown",
        localReason: "no_match",
      }));
    }
    expect(trace.summarize().diagnostics).toHaveLength(8);
    expect(trace.summarize().diagnostics[0]).toMatchObject({ focusedSecond: 4 });
  });

  it("rejects observations whose patrol or deviation counters are not exact", () => {
    const wrongFirstNode = new Stage3B1RunTrace();
    const invalidFirst = allowedNode();
    invalidFirst.patrolCount = 2;
    expect(wrongFirstNode.accept(invalidFirst)).toBe("stop-fail");
    expect(wrongFirstNode.summarize().pass).toBe(false);

    const wrongSecondNode = new Stage3B1RunTrace();
    expect(wrongSecondNode.accept(allowedNode())).toBe("continue");
    const invalidSecond = blockedNode(180);
    invalidSecond.deviationCount = 3;
    invalidSecond.patrolCount = 7;
    expect(wrongSecondNode.accept(invalidSecond)).toBe("stop-fail");
    expect(wrongSecondNode.summarize().pass).toBe(false);
  });

  it("requires a clean runtime, graceful shutdown receipt and all cleanup gates", () => {
    const trace = new Stage3B1RunTrace();
    trace.accept(allowedNode());
    trace.accept(blockedNode());
    const baseline = {
      interrupted: false,
      failFastReason: null,
      traceSummary: trace.summarize(),
      shellReady: true,
      setupDialogReady: true,
      gpuCrashCount: 0,
      childExitCode: 0,
      shutdownPass: true,
      processCleanupPass: true,
      mockRequestCount: 0,
      mockInvalidRequestCount: 0,
      privacyPass: true,
      cleanupPass: true,
    };
    expect(evaluateStage3B1RunOutcome(baseline)).toBe(true);
    expect(evaluateStage3B1RunOutcome({ ...baseline, shutdownPass: false })).toBe(false);
    expect(evaluateStage3B1RunOutcome({ ...baseline, childExitCode: 1 })).toBe(false);
    expect(evaluateStage3B1RunOutcome({ ...baseline, gpuCrashCount: 1 })).toBe(false);
  });
});
