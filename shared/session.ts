import type { ReactionKey } from "./partner-pack.js";

export const SESSION_PHASES = [
  "preparing",
  "focusing",
  "patrolling",
  "feedback",
  "break",
  "completed",
  "aborted",
  "interrupted",
] as const;

export const OBSERVATION_LABELS = ["focused", "uncertain", "distracted"] as const;
export const SESSION_GRADES = ["S", "A", "B", "C", "D"] as const;

export type SessionPhase = (typeof SESSION_PHASES)[number];
export type ObservationLabel = (typeof OBSERVATION_LABELS)[number];
export type SessionGrade = (typeof SESSION_GRADES)[number];
export type SessionFinishMode = "completed" | "aborted" | "interrupted";

export interface StartSessionInput {
  partnerId: string;
  packVersion: string;
  sceneId: string;
  goal: string;
  plannedMinutes: number;
}

export interface SessionOutcome {
  mode: SessionFinishMode;
  completionRatio: number;
  grade: SessionGrade | null;
  trustGained: number;
}

export interface SessionSnapshot {
  sessionId: string;
  partnerId: string;
  packVersion: string;
  sceneId: string;
  goal: string;
  plannedSeconds: number;
  phase: SessionPhase;
  paused: boolean;
  focusedSeconds: number;
  uncertainSeconds: number;
  distractedSeconds: number;
  focusedStreakSeconds: number;
  deviationCount: number;
  patrolCount: number;
  nextPatrolAtFocusedSecond: number;
  randomState: number;
  recoveryPending: boolean;
  plannedReached: boolean;
  breakRemainingSeconds: number;
  lastObservation: ObservationLabel | null;
  reactionKey: ReactionKey;
  outcome: SessionOutcome | null;
  recoveredFromCheckpoint: boolean;
}

export interface SessionHistoryEntry {
  sessionId: string;
  partnerId: string;
  packVersion: string;
  sceneId: string;
  goal: string;
  plannedSeconds: number;
  focusedSeconds: number;
  deviationCount: number;
  phase: "completed" | "aborted" | "interrupted";
  grade: SessionGrade | null;
  trustGained: number;
  startedAt: string;
  endedAt: string;
}

export interface PartnerProgressSnapshot {
  partnerId: string;
  totalTrust: number;
  currentLevelId: string;
  lastSessionAt: string | null;
}

export interface SessionStartOptions {
  sessionId: string;
  seed: number;
}

export type SessionCommand =
  | { type: "prepared" }
  | { type: "tick"; seconds?: number }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "trigger-patrol" }
  | { type: "record-observation"; label: ObservationLabel }
  | { type: "complete-feedback" }
  | { type: "start-break"; seconds?: number }
  | { type: "finish"; mode: SessionFinishMode };

export interface SessionControllerApi {
  getActiveSession: () => Promise<SessionSnapshot | null>;
  startSession: (input: StartSessionInput) => Promise<SessionSnapshot>;
  pauseSession: (sessionId: string) => Promise<SessionSnapshot>;
  resumeSession: (sessionId: string) => Promise<SessionSnapshot>;
  previewSessionPatrol: (sessionId: string) => Promise<SessionSnapshot>;
  triggerSessionPatrol: (sessionId: string) => Promise<SessionSnapshot>;
  recordSessionObservation: (
    sessionId: string,
    label: ObservationLabel,
  ) => Promise<SessionSnapshot>;
  completeSessionFeedback: (sessionId: string) => Promise<SessionSnapshot>;
  startSessionBreak: (sessionId: string) => Promise<SessionSnapshot>;
  finishSession: (
    sessionId: string,
    mode: SessionFinishMode,
  ) => Promise<SessionSnapshot>;
  listSessionHistory: (limit?: number) => Promise<SessionHistoryEntry[]>;
  getPartnerProgress: (partnerId: string) => Promise<PartnerProgressSnapshot>;
  onSessionChanged: (listener: (snapshot: SessionSnapshot) => void) => () => void;
}
