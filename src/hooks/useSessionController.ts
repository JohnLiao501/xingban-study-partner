import { useEffect, useState } from "react";
import { advanceSession, createSession } from "../../shared/session-engine";
import type {
  ObservationLabel,
  PartnerProgressSnapshot,
  SessionFinishMode,
  SessionHistoryEntry,
  SessionSnapshot,
  StartSessionInput,
} from "../../shared/session";

const TERMINAL_PHASES = new Set(["completed", "aborted", "interrupted"]);
const MINIMUM_PREVIEW_PATROL_SECOND = 2 * 60;

function browserSessionId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `browser-${Date.now()}`;
}

function browserSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] ?? Date.now();
}

export function useSessionController() {
  const [snapshot, setSnapshot] = useState<SessionSnapshot | null>(null);
  const [history, setHistory] = useState<SessionHistoryEntry[]>([]);
  const [progressByPartner, setProgressByPartner] = useState<Record<string, PartnerProgressSnapshot>>({});
  const [error, setError] = useState<string>();
  const desktopApi = window.studyPartner;

  useEffect(() => {
    if (!desktopApi) return undefined;
    let active = true;
    void Promise.all([
      desktopApi.getActiveSession(),
      desktopApi.listSessionHistory(),
    ])
      .then(([current, entries]) => {
        if (!active) return;
        setSnapshot(current);
        setHistory(entries);
      })
      .catch((reason: unknown) => {
        if (active) setError(reason instanceof Error ? reason.message : "SESSION_LOAD_FAILED");
      });
    const unsubscribe = desktopApi.onSessionChanged((next) => {
      if (active) setSnapshot(next);
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [desktopApi]);

  useEffect(() => {
    if (desktopApi) return undefined;
    const timer = window.setInterval(() => {
      setSnapshot((current) => current ? advanceSession(current, { type: "tick" }) : current);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [desktopApi]);

  const run = async (
    desktopOperation: (() => Promise<SessionSnapshot>) | undefined,
    browserOperation: (current: SessionSnapshot) => SessionSnapshot,
  ): Promise<void> => {
    setError(undefined);
    try {
      if (desktopOperation) {
        setSnapshot(await desktopOperation());
        return;
      }
      if (!snapshot) throw new Error("SESSION_NOT_FOUND");
      setSnapshot(browserOperation(snapshot));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "SESSION_COMMAND_FAILED");
    }
  };

  const start = async (input: StartSessionInput): Promise<void> => {
    setError(undefined);
    try {
      if (desktopApi) {
        setSnapshot(await desktopApi.startSession(input));
        return;
      }
      const preparing = createSession(input, {
        sessionId: browserSessionId(),
        seed: browserSeed(),
      });
      setSnapshot(advanceSession(preparing, { type: "prepared" }));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "SESSION_START_FAILED");
    }
  };

  const requireId = (): string => snapshot?.sessionId ?? "";

  const refreshHistory = async (): Promise<void> => {
    if (!desktopApi) return;
    try {
      setHistory(await desktopApi.listSessionHistory());
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "HISTORY_LOAD_FAILED");
    }
  };

  const refreshProgress = async (partnerId: string): Promise<void> => {
    if (!desktopApi) {
      setProgressByPartner((current) => current[partnerId] ? current : {
        ...current,
        [partnerId]: {
          partnerId,
          totalTrust: 0,
          currentLevelId: "initial",
          lastSessionAt: null,
        },
      });
      return;
    }
    try {
      const progress = await desktopApi.getPartnerProgress(partnerId);
      setProgressByPartner((current) => ({ ...current, [partnerId]: progress }));
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "PROGRESS_LOAD_FAILED");
    }
  };

  const finish = async (mode: SessionFinishMode): Promise<void> => {
    if (!snapshot) {
      setError("SESSION_NOT_FOUND");
      return;
    }
    setError(undefined);
    try {
      const settled = desktopApi
        ? await desktopApi.finishSession(snapshot.sessionId, mode)
        : advanceSession(snapshot, { type: "finish", mode });
      setSnapshot(settled);
      const outcome = settled.outcome;
      if (!outcome) return;

      if (desktopApi) {
        const [entries, progress] = await Promise.all([
          desktopApi.listSessionHistory(),
          desktopApi.getPartnerProgress(settled.partnerId),
        ]);
        setHistory(entries);
        setProgressByPartner((current) => ({ ...current, [settled.partnerId]: progress }));
        return;
      }

      const endedAt = new Date().toISOString();
      const entry: SessionHistoryEntry = {
        sessionId: settled.sessionId,
        partnerId: settled.partnerId,
        packVersion: settled.packVersion,
        sceneId: settled.sceneId,
        goal: settled.goal,
        plannedSeconds: settled.plannedSeconds,
        focusedSeconds: settled.focusedSeconds,
        deviationCount: settled.deviationCount,
        phase: settled.phase as SessionHistoryEntry["phase"],
        grade: outcome.grade,
        trustGained: outcome.trustGained,
        startedAt: endedAt,
        endedAt,
      };
      setHistory((current) => [entry, ...current.filter((item) => item.sessionId !== entry.sessionId)]);
      setProgressByPartner((current) => {
        const previous = current[settled.partnerId] ?? {
          partnerId: settled.partnerId,
          totalTrust: 0,
          currentLevelId: "initial",
          lastSessionAt: null,
        };
        return {
          ...current,
          [settled.partnerId]: {
            ...previous,
            totalTrust: previous.totalTrust + outcome.trustGained,
            lastSessionAt: endedAt,
          },
        };
      });
    } catch (reason: unknown) {
      setError(reason instanceof Error ? reason.message : "SESSION_COMMAND_FAILED");
    }
  };

  return {
    snapshot,
    history,
    progressByPartner,
    error,
    active: Boolean(snapshot && !TERMINAL_PHASES.has(snapshot.phase)),
    start,
    refreshHistory,
    refreshProgress,
    pause: () => run(
      desktopApi ? () => desktopApi.pauseSession(requireId()) : undefined,
      (current) => advanceSession(current, { type: "pause" }),
    ),
    resume: () => run(
      desktopApi ? () => desktopApi.resumeSession(requireId()) : undefined,
      (current) => advanceSession(current, { type: "resume" }),
    ),
    previewPatrol: () => run(
      desktopApi ? () => desktopApi.previewSessionPatrol(requireId()) : undefined,
      (current) => {
        const eligible = current.focusedSeconds < MINIMUM_PREVIEW_PATROL_SECOND
          ? advanceSession(current, {
              type: "tick",
              seconds: MINIMUM_PREVIEW_PATROL_SECOND - current.focusedSeconds,
            })
          : current;
        return advanceSession(eligible, { type: "trigger-patrol" });
      },
    ),
    observe: (label: ObservationLabel) => run(
      desktopApi ? () => desktopApi.recordSessionObservation(requireId(), label) : undefined,
      (current) => advanceSession(current, { type: "record-observation", label }),
    ),
    completeFeedback: () => run(
      desktopApi ? () => desktopApi.completeSessionFeedback(requireId()) : undefined,
      (current) => advanceSession(current, { type: "complete-feedback" }),
    ),
    startBreak: () => run(
      desktopApi ? () => desktopApi.startSessionBreak(requireId()) : undefined,
      (current) => advanceSession(current, { type: "start-break" }),
    ),
    finish,
  };
}
