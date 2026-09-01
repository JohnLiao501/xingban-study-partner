import {
  CAPTURE_STATUSES,
  INSPECTION_SOURCES,
  OBSERVATION_REASON_CODES,
  type CaptureStatus,
} from "../../shared/inspection.js";
import { OBSERVATION_LABELS, SESSION_PHASES } from "../../shared/session.js";
import type { Stage3AcceptanceEvent } from "./stage3-recorder.js";

const EVENT_KEYS = [
  "kind",
  "focusedSecond",
  "phase",
  "paused",
  "label",
  "reasonCode",
  "source",
  "deviationCount",
  "patrolCount",
  "captureStatus",
  "confirmedDeviation",
  "processMatch",
  "localVerdict",
  "localReason",
  "pass",
] as const;

const EXPECTED_OBSERVATIONS = [
  [120, 120, "focused", "allowed_app", "local-rule", false],
  [180, 180, "distracted", "blocked_app", "local-rule", true],
  [300, 300, "focused", "task_related_content", "vision-api", false],
  [480, 485, "uncertain", "private_communication", "vision-api", false],
  [660, 660, "uncertain", "entertainment_content", "vision-api", false],
  [660, 660, "distracted", "entertainment_content", "vision-api", true],
  [900, 900, "uncertain", "capture_unavailable", "fallback", false],
  [1080, 1080, "focused", "task_related_content", "vision-api", false],
] as const;

export interface Stage3RunTraceSummary {
  eventCount: number;
  observationCount: number;
  invalidEventCount: number;
  expectedObservationSequence: boolean;
  captureRestarted: boolean;
  pauseResumeObserved: boolean;
  completedSnapshotObserved: boolean;
  finalEventObserved: boolean;
  pass: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nullableMember<T extends string>(
  value: unknown,
  allowed: readonly T[],
): value is T | null {
  return value === null || (typeof value === "string" && allowed.includes(value as T));
}

export function validateStage3AcceptanceEvent(value: unknown): Stage3AcceptanceEvent | null {
  if (!isRecord(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== EVENT_KEYS.length || !keys.every((key) => EVENT_KEYS.includes(key as typeof EVENT_KEYS[number]))) {
    return null;
  }
  if (
    !["snapshot", "classification", "observation", "capture", "final"].includes(String(value.kind)) ||
    !Number.isInteger(value.focusedSecond) ||
    (value.focusedSecond as number) < 0 ||
    (value.focusedSecond as number) > 1500 ||
    !nullableMember(value.phase, SESSION_PHASES) ||
    typeof value.paused !== "boolean" ||
    !nullableMember(value.label, OBSERVATION_LABELS) ||
    !nullableMember(value.reasonCode, OBSERVATION_REASON_CODES) ||
    !nullableMember(value.source, INSPECTION_SOURCES) ||
    !Number.isInteger(value.deviationCount) ||
    (value.deviationCount as number) < 0 ||
    (value.deviationCount as number) > 3 ||
    !Number.isInteger(value.patrolCount) ||
    (value.patrolCount as number) < 0 ||
    (value.patrolCount as number) > 7 ||
    typeof value.captureStatus !== "string" ||
    !CAPTURE_STATUSES.includes(value.captureStatus as CaptureStatus) ||
    typeof value.confirmedDeviation !== "boolean" ||
    !nullableMember(value.processMatch, ["allow", "block", "other", "none"] as const) ||
    !nullableMember(value.localVerdict, ["focused", "distracted", "unknown"] as const) ||
    !nullableMember(value.localReason, [
      "allowed_app",
      "blocked_app",
      "no_match",
      "conflict",
      "probe_unavailable",
      "block_duration_insufficient",
    ] as const) ||
    typeof value.pass !== "boolean"
  ) {
    return null;
  }
  return value as unknown as Stage3AcceptanceEvent;
}

function isSubsequence(values: readonly CaptureStatus[], expected: readonly CaptureStatus[]): boolean {
  let index = 0;
  for (const value of values) {
    if (value === expected[index]) index += 1;
    if (index === expected.length) return true;
  }
  return false;
}

export class Stage3RunTrace {
  private readonly events: Stage3AcceptanceEvent[] = [];
  private invalidEventCount = 0;

  accept(value: unknown): boolean {
    const event = validateStage3AcceptanceEvent(value);
    if (!event) {
      this.invalidEventCount += 1;
      return false;
    }
    this.events.push(event);
    return true;
  }

  summarize(): Stage3RunTraceSummary {
    const observations = this.events.filter((event) => event.kind === "observation");
    const expectedObservationSequence = observations.length === EXPECTED_OBSERVATIONS.length &&
      observations.every((event, index) => {
        const expected = EXPECTED_OBSERVATIONS[index]!;
        return event.focusedSecond >= expected[0] &&
          event.focusedSecond <= expected[1] &&
          event.label === expected[2] &&
          event.reasonCode === expected[3] &&
          event.source === expected[4] &&
          event.confirmedDeviation === expected[5];
      });

    const captureRestarted = isSubsequence(
      this.events
        .filter((event) => event.kind === "capture")
        .map((event) => event.captureStatus),
      ["active", "stopped", "active"],
    );

    const pauseIndex = this.events.findIndex((event) => (
      event.kind === "snapshot" &&
      event.paused &&
      event.focusedSecond >= 960 &&
      event.focusedSecond < 1080
    ));
    const pauseResumeObserved = pauseIndex >= 0 && this.events.slice(pauseIndex + 1).some((event) => (
      event.kind === "snapshot" &&
      !event.paused &&
      event.phase === "focusing" &&
      event.focusedSecond >= 960 &&
      event.focusedSecond < 1080
    ));

    const completedSnapshotObserved = this.events.some((event) => (
      event.kind === "snapshot" &&
      event.phase === "completed" &&
      event.focusedSecond === 1500 &&
      event.deviationCount === 2 &&
      event.patrolCount === 7
    ));
    const finalEventObserved = this.events.some((event) => (
      event.kind === "final" &&
      event.phase === "completed" &&
      event.focusedSecond === 1500 &&
      event.deviationCount === 2 &&
      event.pass
    ));

    const summary: Stage3RunTraceSummary = {
      eventCount: this.events.length,
      observationCount: observations.length,
      invalidEventCount: this.invalidEventCount,
      expectedObservationSequence,
      captureRestarted,
      pauseResumeObserved,
      completedSnapshotObserved,
      finalEventObserved,
      pass: false,
    };
    summary.pass = summary.invalidEventCount === 0 &&
      summary.expectedObservationSequence &&
      summary.captureRestarted &&
      summary.pauseResumeObserved &&
      summary.completedSnapshotObserved &&
      summary.finalEventObserved;
    return summary;
  }
}
