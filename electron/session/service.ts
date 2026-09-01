import { randomBytes, randomUUID } from "node:crypto";
import {
  advanceSession,
  createSession,
} from "../../shared/session-engine.js";
import type {
  ObservationLabel,
  SessionFinishMode,
  SessionSnapshot,
  StartSessionInput,
} from "../../shared/session.js";
import { SESSION_FEEDBACK_AUTO_CONTINUE_MS } from "../../shared/session.js";
import type { XingbanDatabase } from "../storage/database.js";

const TERMINAL_PHASES = new Set(["completed", "aborted", "interrupted"]);
const MINIMUM_MANUAL_PATROL_SECOND = 2 * 60;

export interface SessionServiceOptions {
  seedFactory?: () => number;
  normalizeSnapshot?: (snapshot: SessionSnapshot) => SessionSnapshot;
  feedbackAutoContinueMs?: number;
}

export class SessionService {
  private snapshot: SessionSnapshot | null;
  private readonly timer: NodeJS.Timeout;
  private feedbackTimer: NodeJS.Timeout | undefined;

  constructor(
    private readonly onChanged: (snapshot: SessionSnapshot) => void,
    private readonly persistence?: XingbanDatabase,
    private readonly resolveLevelId: (partnerId: string, totalTrust: number) => string = () => "initial",
    private readonly options: SessionServiceOptions = {},
  ) {
    this.snapshot = persistence?.loadRecoverableSession() ?? null;
    this.timer = setInterval(() => {
      if (!this.snapshot) return;
      const next = advanceSession(this.snapshot, { type: "tick" });
      if (next !== this.snapshot) this.publish(next);
    }, 1_000);
    this.timer.unref();
    if (this.snapshot) this.syncFeedbackTimer(this.snapshot);
  }

  getActive(): SessionSnapshot | null {
    return this.snapshot;
  }

  start(input: StartSessionInput): SessionSnapshot {
    if (this.snapshot && !TERMINAL_PHASES.has(this.snapshot.phase)) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }
    const seed = this.options.seedFactory?.() ?? randomBytes(4).readUInt32LE(0);
    const preparing = createSession(input, { sessionId: randomUUID(), seed });
    return this.publish(advanceSession(preparing, { type: "prepared" }), true);
  }

  pause(sessionId: string): SessionSnapshot {
    return this.command(sessionId, { type: "pause" });
  }

  resume(sessionId: string): SessionSnapshot {
    return this.command(sessionId, { type: "resume" });
  }

  previewPatrol(sessionId: string): SessionSnapshot {
    const snapshot = this.requireSession(sessionId);
    let eligible = snapshot;
    if (snapshot.focusedSeconds < MINIMUM_MANUAL_PATROL_SECOND) {
      eligible = advanceSession(snapshot, {
        type: "tick",
        seconds: MINIMUM_MANUAL_PATROL_SECOND - snapshot.focusedSeconds,
      });
    }
    return this.publish(advanceSession(eligible, { type: "trigger-patrol" }));
  }

  triggerPatrol(sessionId: string): SessionSnapshot {
    return this.command(sessionId, { type: "trigger-patrol" });
  }

  recordObservation(sessionId: string, label: ObservationLabel): SessionSnapshot {
    const snapshot = this.command(sessionId, { type: "record-observation", label });
    this.persistence?.recordObservation(snapshot, label);
    return snapshot;
  }

  /**
   * 应用已经由 InspectionEngine 单独持久化的结构化观察，只推进会话状态。
   * 与浏览器预览使用的纯状态机手工入口分离，避免同一次巡查写入两条 observation。
   */
  applyInspectionResult(sessionId: string, label: ObservationLabel): SessionSnapshot {
    return this.command(sessionId, { type: "record-observation", label });
  }

  completeFeedback(sessionId: string): SessionSnapshot {
    const snapshot = this.requireSession(sessionId);
    if (snapshot.phase !== "feedback" || snapshot.plannedReached) return snapshot;
    return this.command(sessionId, { type: "complete-feedback" });
  }

  startBreak(sessionId: string): SessionSnapshot {
    return this.command(sessionId, { type: "start-break" });
  }

  finish(sessionId: string, mode: SessionFinishMode): SessionSnapshot {
    return this.command(sessionId, { type: "finish", mode });
  }

  dispose(): void {
    clearInterval(this.timer);
    this.clearFeedbackTimer();
    if (this.snapshot && !TERMINAL_PHASES.has(this.snapshot.phase)) {
      this.persistence?.saveSession(this.snapshot);
    }
  }

  private requireSession(sessionId: string): SessionSnapshot {
    if (!this.snapshot || this.snapshot.sessionId !== sessionId) {
      throw new Error("SESSION_NOT_FOUND");
    }
    return this.snapshot;
  }

  private command(
    sessionId: string,
    command: Parameters<typeof advanceSession>[1],
  ): SessionSnapshot {
    return this.publish(advanceSession(this.requireSession(sessionId), command));
  }

  private publish(snapshot: SessionSnapshot, force = false): SessionSnapshot {
    snapshot = this.options.normalizeSnapshot?.(snapshot) ?? snapshot;
    const previous = this.snapshot;
    this.snapshot = snapshot;
    this.syncFeedbackTimer(snapshot);
    const terminal = TERMINAL_PHASES.has(snapshot.phase);
    const shouldCheckpoint = force || terminal || previous?.phase !== snapshot.phase || snapshot.focusedSeconds % 5 === 0;
    if (terminal && snapshot.outcome) {
      this.persistence?.finalizeSession(
        snapshot,
        (totalTrust) => this.resolveLevelId(snapshot.partnerId, totalTrust),
      );
    } else if (shouldCheckpoint) {
      this.persistence?.saveSession(snapshot);
    }
    this.onChanged(snapshot);
    return snapshot;
  }

  private syncFeedbackTimer(snapshot: SessionSnapshot): void {
    this.clearFeedbackTimer();
    if (snapshot.phase !== "feedback" || snapshot.plannedReached) return;

    const sessionId = snapshot.sessionId;
    const delayMs = this.options.feedbackAutoContinueMs ?? SESSION_FEEDBACK_AUTO_CONTINUE_MS;
    this.feedbackTimer = setTimeout(() => {
      this.feedbackTimer = undefined;
      const current = this.snapshot;
      if (
        current?.sessionId !== sessionId ||
        current.phase !== "feedback" ||
        current.plannedReached
      ) return;
      this.publish(advanceSession(current, { type: "complete-feedback" }));
    }, Math.max(0, delayMs));
    this.feedbackTimer.unref();
  }

  private clearFeedbackTimer(): void {
    if (!this.feedbackTimer) return;
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = undefined;
  }
}
