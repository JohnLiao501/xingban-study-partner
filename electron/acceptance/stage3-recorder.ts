import type { CaptureStatus, InspectionResult } from "../../shared/inspection.js";
import type { SessionSnapshot } from "../../shared/session.js";
import type { ClassificationResult } from "../inspection/local-rule-classifier.js";

export type Stage3AcceptanceProcessMatch = "allow" | "block" | "other" | "none";

export interface Stage3AcceptanceEvent {
  kind: "snapshot" | "classification" | "observation" | "capture" | "final";
  focusedSecond: number;
  phase: SessionSnapshot["phase"] | null;
  paused: boolean;
  label: SessionSnapshot["lastObservation"];
  reasonCode: InspectionResult["reasonCode"] | null;
  source: InspectionResult["source"] | null;
  deviationCount: number;
  patrolCount: number;
  captureStatus: CaptureStatus;
  confirmedDeviation: boolean;
  processMatch: Stage3AcceptanceProcessMatch | null;
  localVerdict: ClassificationResult["verdict"] | null;
  localReason: ClassificationResult["reason"] | null;
  pass: boolean;
}

interface Stage3AcceptanceExpectedProcesses {
  allowProcessName: string;
  blockProcessName: string;
}

function normalizeProcessName(value: string): string {
  const normalized = value.trim().toLocaleLowerCase("en-US");
  return normalized.endsWith(".exe") ? normalized.slice(0, -4) : normalized;
}

export class Stage3AcceptanceRecorder {
  private captureStatus: CaptureStatus = "inactive";
  private latestSnapshot: SessionSnapshot | null = null;
  private lastSnapshotKey = "";

  constructor(
    private readonly emit: (event: Stage3AcceptanceEvent) => void,
    private readonly expectedProcesses?: Stage3AcceptanceExpectedProcesses,
  ) {}

  recordSnapshot(snapshot: SessionSnapshot): void {
    this.latestSnapshot = snapshot;
    const meaningfulSecond = snapshot.focusedSeconds % 60 === 0;
    const key = [
      snapshot.phase,
      snapshot.paused,
      snapshot.deviationCount,
      snapshot.patrolCount,
      snapshot.lastObservation,
      meaningfulSecond ? snapshot.focusedSeconds : "",
    ].join("|");
    if (key === this.lastSnapshotKey) return;
    this.lastSnapshotKey = key;
    this.emit(this.event("snapshot", snapshot, null, false, true));
  }

  recordObservation(result: InspectionResult, confirmedDeviation: boolean): void {
    this.emit(this.event(
      "observation",
      this.latestSnapshot,
      result,
      confirmedDeviation,
      result.label !== "distracted" || confirmedDeviation,
    ));
  }

  recordLocalClassification(
    processName: string | null,
    result: ClassificationResult,
  ): void {
    let processMatch: Stage3AcceptanceProcessMatch = "none";
    if (processName) {
      const normalized = normalizeProcessName(processName);
      const allow = this.expectedProcesses
        ? normalizeProcessName(this.expectedProcesses.allowProcessName)
        : null;
      const block = this.expectedProcesses
        ? normalizeProcessName(this.expectedProcesses.blockProcessName)
        : null;
      processMatch = normalized === allow
        ? "allow"
        : normalized === block
          ? "block"
          : "other";
    }
    this.emit({
      ...this.event("classification", this.latestSnapshot, null, false, true),
      processMatch,
      localVerdict: result.verdict,
      localReason: result.reason,
    });
  }

  recordCaptureStatus(status: CaptureStatus): void {
    this.captureStatus = status;
    this.emit(this.event("capture", this.latestSnapshot, null, false, status !== "failed"));
  }

  finalize(): void {
    const snapshot = this.latestSnapshot;
    const pass = Boolean(
      snapshot?.phase === "completed" &&
      snapshot.focusedSeconds >= snapshot.plannedSeconds &&
      snapshot.deviationCount === 2,
    );
    this.emit(this.event("final", snapshot, null, false, pass));
  }

  private event(
    kind: Stage3AcceptanceEvent["kind"],
    snapshot: SessionSnapshot | null,
    result: InspectionResult | null,
    confirmedDeviation: boolean,
    pass: boolean,
  ): Stage3AcceptanceEvent {
    return {
      kind,
      focusedSecond: snapshot?.focusedSeconds ?? 0,
      phase: snapshot?.phase ?? null,
      paused: snapshot?.paused ?? false,
      label: result?.label ?? snapshot?.lastObservation ?? null,
      reasonCode: result?.reasonCode ?? null,
      source: result?.source ?? null,
      deviationCount: snapshot?.deviationCount ?? 0,
      patrolCount: snapshot?.patrolCount ?? 0,
      captureStatus: this.captureStatus,
      confirmedDeviation,
      processMatch: null,
      localVerdict: null,
      localReason: null,
      pass,
    };
  }
}
