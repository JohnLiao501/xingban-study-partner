import { type ReactionKey } from "./partner-pack.js";
import {
  OBSERVATION_LABELS,
  type ObservationLabel,
  type SessionCommand,
  type SessionFinishMode,
  type SessionGrade,
  type SessionOutcome,
  type SessionSnapshot,
  type SessionStartOptions,
  type StartSessionInput,
} from "./session.js";

const FIRST_PATROL_RANGE = [4 * 60, 7 * 60] as const;
const NORMAL_PATROL_RANGE = [3 * 60, 8 * 60] as const;
const REWARDED_PATROL_RANGE = [6 * 60, 10 * 60] as const;
const TIGHT_PATROL_RANGE = [2 * 60, 4 * 60] as const;
const MINIMUM_PATROL_LEAD_SECONDS = 2 * 60;
const PATROL_END_GUARD_SECONDS = 60;
const REWARD_STREAK_SECONDS = 15 * 60;
const TIGHT_RECOVERY_SECONDS = 10 * 60;
const RECOVERY_REACTION_SECONDS = 5 * 60;
const DEFAULT_BREAK_SECONDS = 5 * 60;

const GRADE_RANK: Record<SessionGrade, number> = {
  S: 0,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
};

export class SessionTransitionError extends Error {
  constructor(message = "SESSION_INVALID_TRANSITION") {
    super(message);
    this.name = "SessionTransitionError";
  }
}

function assert(condition: boolean, message = "SESSION_INVALID_TRANSITION"): asserts condition {
  if (!condition) throw new SessionTransitionError(message);
}

function nextRandom(state: number): { state: number; value: number } {
  let nextState = state >>> 0;
  if (nextState === 0) nextState = 0x6d2b79f5;
  nextState ^= nextState << 13;
  nextState ^= nextState >>> 17;
  nextState ^= nextState << 5;
  const normalizedState = nextState >>> 0;
  return { state: normalizedState, value: normalizedState / 0x1_0000_0000 };
}

function scheduleWithin(
  snapshot: SessionSnapshot,
  range: readonly [number, number],
): Pick<SessionSnapshot, "nextPatrolAtFocusedSecond" | "randomState"> {
  const random = nextRandom(snapshot.randomState);
  const [minimum, maximum] = range;
  const interval = minimum + Math.floor(random.value * (maximum - minimum + 1));
  return {
    nextPatrolAtFocusedSecond: snapshot.focusedSeconds + interval,
    randomState: random.state,
  };
}

function patrolRangeFor(snapshot: SessionSnapshot): readonly [number, number] {
  if (snapshot.recoveryPending && snapshot.focusedStreakSeconds < TIGHT_RECOVERY_SECONDS) {
    return TIGHT_PATROL_RANGE;
  }
  if (snapshot.focusedStreakSeconds >= REWARD_STREAK_SECONDS) return REWARDED_PATROL_RANGE;
  return NORMAL_PATROL_RANGE;
}

function baseGrade(completionRatio: number): SessionGrade {
  if (completionRatio >= 1) return "S";
  if (completionRatio >= 0.8) return "A";
  if (completionRatio >= 0.6) return "B";
  if (completionRatio >= 0.4) return "C";
  return "D";
}

function applyDeviationCap(grade: SessionGrade, deviations: number): SessionGrade {
  const cap: SessionGrade = deviations >= 3 ? "C" : deviations === 2 ? "B" : deviations === 1 ? "A" : "S";
  return GRADE_RANK[grade] >= GRADE_RANK[cap] ? grade : cap;
}

export function calculateSessionOutcome(
  snapshot: SessionSnapshot,
  mode: SessionFinishMode,
): SessionOutcome {
  const completionRatio = Math.min(1, snapshot.focusedSeconds / snapshot.plannedSeconds);
  if (mode === "interrupted") {
    return { mode, completionRatio, grade: null, trustGained: 0 };
  }
  const grade = mode === "aborted"
    ? "D"
    : applyDeviationCap(baseGrade(completionRatio), snapshot.deviationCount);
  const effectiveMinutes = Math.floor(snapshot.focusedSeconds / 60);
  const completionBonus = mode === "completed" && completionRatio >= 0.8 ? 10 : 0;
  const trustGained = Math.max(0, effectiveMinutes + completionBonus - snapshot.deviationCount * 3);
  return { mode, completionRatio, grade, trustGained };
}

export function createSession(
  input: StartSessionInput,
  options: SessionStartOptions,
): SessionSnapshot {
  const goal = input.goal.trim();
  assert(goal.length >= 1 && goal.length <= 500, "SESSION_INVALID_GOAL");
  assert(Number.isInteger(input.plannedMinutes), "SESSION_INVALID_DURATION");
  assert(input.plannedMinutes >= 10 && input.plannedMinutes <= 180, "SESSION_INVALID_DURATION");
  assert(Boolean(input.partnerId && input.packVersion && input.sceneId), "SESSION_INVALID_PARTNER");

  const base: SessionSnapshot = {
    sessionId: options.sessionId,
    partnerId: input.partnerId,
    packVersion: input.packVersion,
    sceneId: input.sceneId,
    goal,
    plannedSeconds: input.plannedMinutes * 60,
    phase: "preparing",
    paused: false,
    focusedSeconds: 0,
    uncertainSeconds: 0,
    distractedSeconds: 0,
    focusedStreakSeconds: 0,
    deviationCount: 0,
    patrolCount: 0,
    nextPatrolAtFocusedSecond: 0,
    randomState: options.seed >>> 0,
    recoveryPending: false,
    plannedReached: false,
    breakRemainingSeconds: 0,
    lastObservation: null,
    reactionKey: "session_start",
    outcome: null,
    recoveredFromCheckpoint: false,
  };
  return { ...base, ...scheduleWithin(base, FIRST_PATROL_RANGE) };
}

function tickOnce(snapshot: SessionSnapshot): SessionSnapshot {
  if (snapshot.paused) return snapshot;
  if (snapshot.phase === "break") {
    if (snapshot.breakRemainingSeconds <= 1) return settle(snapshot, "completed");
    return { ...snapshot, breakRemainingSeconds: snapshot.breakRemainingSeconds - 1 };
  }
  if (snapshot.phase !== "focusing") return snapshot;

  const focusedSeconds = snapshot.focusedSeconds + 1;
  const focusedStreakSeconds = snapshot.focusedStreakSeconds + 1;
  let next = { ...snapshot, focusedSeconds, focusedStreakSeconds };

  if (next.recoveryPending && focusedStreakSeconds >= RECOVERY_REACTION_SECONDS) {
    return {
      ...next,
      phase: "feedback",
      recoveryPending: false,
      reactionKey: "recovery",
    };
  }

  if (focusedSeconds >= snapshot.plannedSeconds) {
    return {
      ...next,
      phase: "feedback",
      plannedReached: true,
      reactionKey: "break_invite",
    };
  }

  const remainingSeconds = snapshot.plannedSeconds - focusedSeconds;
  const patrolAllowed = focusedSeconds >= MINIMUM_PATROL_LEAD_SECONDS &&
    remainingSeconds > PATROL_END_GUARD_SECONDS &&
    focusedSeconds >= snapshot.nextPatrolAtFocusedSecond;
  if (patrolAllowed) {
    next = {
      ...next,
      phase: "patrolling",
      patrolCount: next.patrolCount + 1,
      reactionKey: "patrol_enter",
    };
  }
  return next;
}

function tick(snapshot: SessionSnapshot, seconds: number): SessionSnapshot {
  assert(Number.isInteger(seconds) && seconds >= 0 && seconds <= 10_800, "SESSION_INVALID_TICK");
  let next = snapshot;
  for (let index = 0; index < seconds; index += 1) {
    const before = next;
    next = tickOnce(next);
    if (next.phase !== before.phase) break;
  }
  return next;
}

function triggerPatrol(snapshot: SessionSnapshot): SessionSnapshot {
  assert(snapshot.phase === "focusing" && !snapshot.paused);
  const remainingSeconds = snapshot.plannedSeconds - snapshot.focusedSeconds;
  assert(snapshot.focusedSeconds >= MINIMUM_PATROL_LEAD_SECONDS, "SESSION_PATROL_TOO_EARLY");
  assert(remainingSeconds > PATROL_END_GUARD_SECONDS, "SESSION_PATROL_TOO_LATE");
  return {
    ...snapshot,
    phase: "patrolling",
    patrolCount: snapshot.patrolCount + 1,
    reactionKey: "patrol_enter",
  };
}

function recordObservation(
  snapshot: SessionSnapshot,
  label: ObservationLabel,
): SessionSnapshot {
  assert(snapshot.phase === "patrolling");
  assert(OBSERVATION_LABELS.includes(label));

  const distracted = label === "distracted";
  const uncertain = label === "uncertain";
  const nextBase: SessionSnapshot = {
    ...snapshot,
    phase: "feedback",
    lastObservation: label,
    deviationCount: snapshot.deviationCount + (distracted ? 1 : 0),
    uncertainSeconds: snapshot.uncertainSeconds + (uncertain ? 1 : 0),
    distractedSeconds: snapshot.distractedSeconds + (distracted ? 1 : 0),
    focusedStreakSeconds: distracted || uncertain ? 0 : snapshot.focusedStreakSeconds,
    recoveryPending: distracted ? true : snapshot.recoveryPending,
    reactionKey: ({
      focused: "focus_confirmed",
      uncertain: "uncertain_nudge",
      distracted: "distracted_warning",
    } satisfies Record<ObservationLabel, ReactionKey>)[label],
  };
  return { ...nextBase, ...scheduleWithin(nextBase, patrolRangeFor(nextBase)) };
}

function completeFeedback(snapshot: SessionSnapshot): SessionSnapshot {
  assert(snapshot.phase === "feedback" && !snapshot.plannedReached);
  return {
    ...snapshot,
    phase: "focusing",
    reactionKey: "idle_loop",
  };
}

function startBreak(snapshot: SessionSnapshot, seconds: number): SessionSnapshot {
  assert(snapshot.phase === "feedback" && snapshot.plannedReached);
  assert(Number.isInteger(seconds) && seconds > 0 && seconds <= 60 * 60, "SESSION_INVALID_BREAK");
  return {
    ...snapshot,
    phase: "break",
    breakRemainingSeconds: seconds,
    reactionKey: "idle_loop",
  };
}

function settle(snapshot: SessionSnapshot, mode: SessionFinishMode): SessionSnapshot {
  assert(!["completed", "aborted", "interrupted"].includes(snapshot.phase));
  const phase = mode;
  const outcome = calculateSessionOutcome(snapshot, mode);
  const reactionKey: ReactionKey = mode === "completed" && outcome.completionRatio >= 0.8
    ? "session_complete"
    : "session_partial";
  return {
    ...snapshot,
    phase,
    paused: false,
    reactionKey,
    outcome,
  };
}

export function advanceSession(
  snapshot: SessionSnapshot,
  command: SessionCommand,
): SessionSnapshot {
  switch (command.type) {
    case "prepared":
      assert(snapshot.phase === "preparing");
      return { ...snapshot, phase: "focusing" };
    case "tick":
      return tick(snapshot, command.seconds ?? 1);
    case "pause":
      assert(snapshot.phase === "focusing" && !snapshot.paused);
      return { ...snapshot, paused: true };
    case "resume":
      assert(snapshot.phase === "focusing" && snapshot.paused);
      return { ...snapshot, paused: false, recoveredFromCheckpoint: false };
    case "trigger-patrol":
      return triggerPatrol(snapshot);
    case "record-observation":
      return recordObservation(snapshot, command.label);
    case "complete-feedback":
      return completeFeedback(snapshot);
    case "start-break":
      return startBreak(snapshot, command.seconds ?? DEFAULT_BREAK_SECONDS);
    case "finish":
      return settle(snapshot, command.mode);
  }
}

export function remainingDeviationAllowance(snapshot: SessionSnapshot): number {
  return Math.max(0, 3 - snapshot.deviationCount);
}

export function remainingFocusSeconds(snapshot: SessionSnapshot): number {
  return Math.max(0, snapshot.plannedSeconds - snapshot.focusedSeconds);
}
