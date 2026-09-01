import { describe, expect, it } from "vitest";
import type { Stage3AcceptanceEvent } from "./stage3-recorder.js";
import { Stage3RunTrace } from "./stage3-run-trace.js";

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

describe("stage 3 acceptance run trace", () => {
  it("requires the exact eight observations, capture restart, pause/resume and final settlement", () => {
    const trace = new Stage3RunTrace();
    trace.accept(event({ kind: "capture", captureStatus: "active" }));
    for (const observation of [
      [120, "focused", "allowed_app", "local-rule", false, 0, 1],
      [180, "distracted", "blocked_app", "local-rule", true, 1, 2],
      [300, "focused", "task_related_content", "vision-api", false, 1, 3],
      [480, "uncertain", "private_communication", "vision-api", false, 1, 4],
      [660, "uncertain", "entertainment_content", "vision-api", false, 1, 5],
      [660, "distracted", "entertainment_content", "vision-api", true, 2, 5],
      [900, "uncertain", "capture_unavailable", "fallback", false, 2, 6],
      [1080, "focused", "task_related_content", "vision-api", false, 2, 7],
    ] as const) {
      trace.accept(event({
        kind: "observation",
        focusedSecond: observation[0],
        label: observation[1],
        reasonCode: observation[2],
        source: observation[3],
        confirmedDeviation: observation[4],
        deviationCount: observation[5],
        patrolCount: observation[6],
      }));
    }
    trace.accept(event({ kind: "capture", focusedSecond: 900, captureStatus: "stopped", deviationCount: 2, patrolCount: 6 }));
    trace.accept(event({ kind: "capture", focusedSecond: 980, captureStatus: "active", deviationCount: 2, patrolCount: 6 }));
    trace.accept(event({ focusedSecond: 1000, paused: true, captureStatus: "active", deviationCount: 2, patrolCount: 6 }));
    trace.accept(event({ focusedSecond: 1000, paused: false, captureStatus: "active", deviationCount: 2, patrolCount: 6 }));
    trace.accept(event({ focusedSecond: 1500, phase: "completed", label: "focused", deviationCount: 2, patrolCount: 7, captureStatus: "stopped" }));
    trace.accept(event({ kind: "final", focusedSecond: 1500, phase: "completed", label: "focused", deviationCount: 2, patrolCount: 7, captureStatus: "stopped" }));

    expect(trace.summarize()).toMatchObject({
      observationCount: 8,
      invalidEventCount: 0,
      expectedObservationSequence: true,
      captureRestarted: true,
      pauseResumeObserved: true,
      completedSnapshotObserved: true,
      finalEventObserved: true,
      pass: true,
    });
  });

  it("fails closed for malformed or incomplete traces", () => {
    const trace = new Stage3RunTrace();
    expect(trace.accept({ kind: "final", extra: "not allowed" })).toBe(false);
    trace.accept(event({ kind: "final", focusedSecond: 1500, phase: "completed", deviationCount: 2, patrolCount: 7 }));
    expect(trace.summarize()).toMatchObject({ invalidEventCount: 1, pass: false });
  });
});
