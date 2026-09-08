import { describe, expect, it } from "vitest";
import { advanceSession, createSession } from "./session-engine.js";
import {
  applyStage3AcceptancePatrolSchedule,
  createStage3AcceptancePlanView,
  getStage3AcceptanceInstruction,
  STAGE3_ACCEPTANCE_PATROL_SECONDS,
} from "./stage3-acceptance.js";

describe("stage 3 acceptance plan", () => {
  it("replaces random patrol timing with the next fixed acceptance node", () => {
    const snapshot = createSession({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
    }, { sessionId: "acceptance-session", seed: 1 });

    const first = applyStage3AcceptancePatrolSchedule(snapshot);
    expect(first.nextPatrolAtFocusedSecond).toBe(STAGE3_ACCEPTANCE_PATROL_SECONDS[0]);

    const afterFirst = applyStage3AcceptancePatrolSchedule({ ...first, focusedSeconds: 120, patrolCount: 1 });
    expect(afterFirst.nextPatrolAtFocusedSecond).toBe(180);

    const afterLast = applyStage3AcceptancePatrolSchedule({ ...first, focusedSeconds: 1080, patrolCount: 7 });
    expect(afterLast.nextPatrolAtFocusedSecond).toBe(1501);
  });

  it("shows reauthorization only after the deliberate stop-sharing segment", () => {
    const plan = createStage3AcceptancePlanView("notepad", "mspaint");
    const stopped = getStage3AcceptanceInstruction(plan, 970, 6, "focusing", false, "stopped");
    const active = getStage3AcceptanceInstruction(plan, 970, 6, "focusing", false, "active");

    expect(stopped.action).toContain("重新授权屏幕");
    expect(active.action).toContain("暂停一次");
  });

  it("keeps the reauthorized capture on an unmatched app for the final AI node", () => {
    const plan = createStage3AcceptancePlanView("notepad", "mspaint");
    for (const second of [970, 1079, 1080, 1081]) {
      const instruction = getStage3AcceptanceInstruction(plan, second, 6, "focusing", false, "active");
      expect(instruction.action).toContain("未命中");
      expect(instruction.action).toContain("mock AI");
      expect(instruction.action).not.toContain("notepad");
    }
  });

  it("does not skip a patrol node when recovery feedback lands on the same focused second", () => {
    const normalize = (snapshot: ReturnType<typeof createSession>) =>
      applyStage3AcceptancePatrolSchedule(snapshot);
    let snapshot = normalize(advanceSession(createSession({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
    }, { sessionId: "acceptance-recovery", seed: 1 }), { type: "prepared" }));

    snapshot = normalize(advanceSession(snapshot, { type: "tick", seconds: 120 }));
    snapshot = normalize(advanceSession(snapshot, { type: "record-observation", label: "focused" }));
    snapshot = normalize(advanceSession(snapshot, { type: "complete-feedback" }));
    snapshot = normalize(advanceSession(snapshot, { type: "tick", seconds: 60 }));
    snapshot = normalize(advanceSession(snapshot, { type: "record-observation", label: "distracted" }));
    snapshot = normalize(advanceSession(snapshot, { type: "complete-feedback" }));
    snapshot = normalize(advanceSession(snapshot, { type: "tick", seconds: 120 }));
    snapshot = normalize(advanceSession(snapshot, { type: "record-observation", label: "focused" }));
    snapshot = normalize(advanceSession(snapshot, { type: "complete-feedback" }));
    snapshot = normalize(advanceSession(snapshot, { type: "tick", seconds: 180 }));

    expect(snapshot).toMatchObject({
      phase: "feedback",
      focusedSeconds: 480,
      patrolCount: 3,
      nextPatrolAtFocusedSecond: 480,
      recoveryPending: false,
    });
    snapshot = normalize(advanceSession(snapshot, { type: "complete-feedback" }));
    snapshot = normalize(advanceSession(snapshot, { type: "tick" }));
    expect(snapshot).toMatchObject({
      phase: "patrolling",
      focusedSeconds: 481,
      patrolCount: 4,
      nextPatrolAtFocusedSecond: 660,
    });
  });
});
