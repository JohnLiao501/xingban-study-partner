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
import type { XingbanDatabase } from "../storage/database.js";

const TERMINAL_PHASES = new Set(["completed", "aborted", "interrupted"]);
const MINIMUM_MANUAL_PATROL_SECOND = 2 * 60;

export class SessionService {
  private snapshot: SessionSnapshot | null;
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly onChanged: (snapshot: SessionSnapshot) => void,
    private readonly persistence?: XingbanDatabase,
    private readonly resolveLevelId: (partnerId: string, totalTrust: number) => string = () => "initial",
  ) {
    this.snapshot = persistence?.loadRecoverableSession() ?? null;
    this.timer = setInterval(() => {
      if (!this.snapshot) return;
      const next = advanceSession(this.snapshot, { type: "tick" });
      if (next !== this.snapshot) this.publish(next);
    }, 1_000);
    this.timer.unref();
  }

  getActive(): SessionSnapshot | null {
    return this.snapshot;
  }

  start(input: StartSessionInput): SessionSnapshot {
    if (this.snapshot && !TERMINAL_PHASES.has(this.snapshot.phase)) {
      throw new Error("SESSION_ALREADY_ACTIVE");
    }
    const seed = randomBytes(4).readUInt32LE(0);
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

  completeFeedback(sessionId: string): SessionSnapshot {
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
    const previous = this.snapshot;
    this.snapshot = snapshot;
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
}
