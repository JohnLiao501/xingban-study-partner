import { describe, expect, it } from "vitest";
import {
  advanceSession,
  calculateSessionOutcome,
  createSession,
  remainingDeviationAllowance,
  remainingFocusSeconds,
  SessionTransitionError,
} from "./session-engine";
import type { SessionSnapshot, StartSessionInput } from "./session";

const input: StartSessionInput = {
  partnerId: "demo.guardian-zero",
  packVersion: "1.0.0",
  sceneId: "quiet-observatory",
  goal: "完成会话引擎测试",
  plannedMinutes: 25,
};

function createFocusing(seed = 42): SessionSnapshot {
  return advanceSession(
    createSession(input, { sessionId: "session-test", seed }),
    { type: "prepared" },
  );
}

describe("session engine", () => {
  it("starts in preparing and enters focusing through a valid transition", () => {
    const preparing = createSession(input, { sessionId: "session-1", seed: 7 });
    expect(preparing.phase).toBe("preparing");
    expect(preparing.reactionKey).toBe("session_start");
    expect(preparing.nextPatrolAtFocusedSecond).toBeGreaterThanOrEqual(4 * 60);
    expect(preparing.nextPatrolAtFocusedSecond).toBeLessThanOrEqual(7 * 60);
    expect(advanceSession(preparing, { type: "prepared" }).phase).toBe("focusing");
  });

  it("uses the same patrol plan for the same seed", () => {
    const first = createFocusing(20260829);
    const replay = createFocusing(20260829);
    const other = createFocusing(20260830);
    expect(first.nextPatrolAtFocusedSecond).toBe(replay.nextPatrolAtFocusedSecond);
    expect(first.randomState).toBe(replay.randomState);
    expect(first.randomState).not.toBe(other.randomState);
  });

  it("does not count time or patrol while paused", () => {
    const paused = advanceSession(createFocusing(), { type: "pause" });
    const afterTick = advanceSession(paused, { type: "tick", seconds: 300 });
    expect(afterTick.focusedSeconds).toBe(0);
    expect(afterTick.patrolCount).toBe(0);
    expect(afterTick.paused).toBe(true);
  });

  it("starts a scheduled patrol at the seeded focus threshold", () => {
    const focusing = createFocusing();
    const before = advanceSession(focusing, {
      type: "tick",
      seconds: focusing.nextPatrolAtFocusedSecond - 1,
    });
    expect(before.phase).toBe("focusing");
    const patrol = advanceSession(before, { type: "tick" });
    expect(patrol.phase).toBe("patrolling");
    expect(patrol.reactionKey).toBe("patrol_enter");
    expect(patrol.patrolCount).toBe(1);
  });

  it("never starts a manual patrol in the first two minutes", () => {
    expect(() => advanceSession(createFocusing(), { type: "trigger-patrol" }))
      .toThrowError("SESSION_PATROL_TOO_EARLY");
  });

  it("uncertain only nudges and never consumes deviation allowance", () => {
    const eligible = advanceSession(createFocusing(), { type: "tick", seconds: 120 });
    const patrol = advanceSession(eligible, { type: "trigger-patrol" });
    const feedback = advanceSession(patrol, {
      type: "record-observation",
      label: "uncertain",
    });
    expect(feedback.reactionKey).toBe("uncertain_nudge");
    expect(feedback.deviationCount).toBe(0);
    expect(remainingDeviationAllowance(feedback)).toBe(3);
  });

  it("continues after three confirmed deviations and applies the C grade cap", () => {
    let snapshot = advanceSession(createFocusing(), { type: "tick", seconds: 120 });
    for (let index = 0; index < 3; index += 1) {
      snapshot = advanceSession(snapshot, { type: "trigger-patrol" });
      snapshot = advanceSession(snapshot, {
        type: "record-observation",
        label: "distracted",
      });
      if (index < 2) snapshot = advanceSession(snapshot, { type: "complete-feedback" });
    }
    expect(snapshot.phase).toBe("feedback");
    expect(snapshot.deviationCount).toBe(3);
    expect(remainingDeviationAllowance(snapshot)).toBe(0);

    const perfect = { ...snapshot, focusedSeconds: snapshot.plannedSeconds };
    expect(calculateSessionOutcome(perfect, "completed")?.grade).toBe("C");
  });

  it("plays recovery after five continuous focused minutes without restoring allowance", () => {
    let snapshot = advanceSession(createFocusing(), { type: "tick", seconds: 120 });
    snapshot = advanceSession(snapshot, { type: "trigger-patrol" });
    snapshot = advanceSession(snapshot, {
      type: "record-observation",
      label: "distracted",
    });
    snapshot = advanceSession(snapshot, { type: "complete-feedback" });
    snapshot = { ...snapshot, nextPatrolAtFocusedSecond: Number.MAX_SAFE_INTEGER };
    snapshot = advanceSession(snapshot, { type: "tick", seconds: 300 });
    expect(snapshot.phase).toBe("feedback");
    expect(snapshot.reactionKey).toBe("recovery");
    expect(snapshot.recoveryPending).toBe(false);
    expect(remainingDeviationAllowance(snapshot)).toBe(2);
  });

  it.each([
    [1, "S"],
    [0.8, "A"],
    [0.6, "B"],
    [0.4, "C"],
    [0.39, "D"],
  ] as const)("grades completion ratio %s as %s", (ratio, grade) => {
    const snapshot = createFocusing();
    const settled = calculateSessionOutcome({
      ...snapshot,
      focusedSeconds: Math.floor(snapshot.plannedSeconds * ratio),
    }, "completed");
    expect(settled?.grade).toBe(grade);
  });

  it("calculates trust using effective minutes, bonus, and deviation penalty", () => {
    const snapshot = {
      ...createFocusing(),
      focusedSeconds: 20 * 60,
      deviationCount: 2,
    };
    expect(calculateSessionOutcome(snapshot, "completed")?.trustGained).toBe(24);
  });

  it("offers a break at planned time and completes when the break ends", () => {
    const focusing = {
      ...createFocusing(),
      focusedSeconds: input.plannedMinutes * 60 - 1,
      nextPatrolAtFocusedSecond: Number.MAX_SAFE_INTEGER,
    };
    const invite = advanceSession(focusing, { type: "tick" });
    expect(invite.phase).toBe("feedback");
    expect(invite.plannedReached).toBe(true);
    expect(invite.reactionKey).toBe("break_invite");

    const resting = advanceSession(invite, { type: "start-break", seconds: 2 });
    expect(remainingFocusSeconds(resting)).toBe(0);
    expect(advanceSession(resting, { type: "tick", seconds: 2 }).phase).toBe("completed");
  });

  it("does not grade or award trust after an interruption", () => {
    const interrupted = advanceSession(
      advanceSession(createFocusing(), { type: "tick", seconds: 600 }),
      { type: "finish", mode: "interrupted" },
    );
    expect(interrupted.outcome).toMatchObject({ grade: null, trustGained: 0 });
  });

  it("rejects invalid transitions without changing the source snapshot", () => {
    const focusing = createFocusing();
    expect(() => advanceSession(focusing, { type: "resume" }))
      .toThrow(SessionTransitionError);
    expect(focusing).toEqual(createFocusing());
  });
});
