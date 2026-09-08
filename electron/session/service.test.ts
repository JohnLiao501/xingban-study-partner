import { afterEach, describe, expect, it, vi } from "vitest";
import type { SessionSnapshot } from "../../shared/session.js";
import { SessionService } from "./service.js";

afterEach(() => {
  vi.useRealTimers();
});

function startService(normalizeSnapshot?: (snapshot: SessionSnapshot) => SessionSnapshot) {
  const service = new SessionService(() => {}, undefined, undefined, {
    feedbackAutoContinueMs: 5_000,
    normalizeSnapshot,
    seedFactory: () => 123,
  });
  const snapshot = service.start({
    partnerId: "demo.guardian-zero",
    packVersion: "1.0.0",
    sceneId: "quiet-observatory",
    goal: "non-blocking feedback",
    plannedMinutes: 25,
  });
  return { service, snapshot };
}

describe("SessionService non-blocking feedback", () => {
  it("reports whether partner mutations must stay locked", () => {
    const { service, snapshot } = startService();
    expect(service.isActive()).toBe(true);
    service.finish(snapshot.sessionId, "interrupted");
    expect(service.isActive()).toBe(false);
    service.dispose();
  });

  it("automatically returns an intermediate result to focusing after five seconds", () => {
    vi.useFakeTimers();
    const { service, snapshot } = startService();

    service.previewPatrol(snapshot.sessionId);
    service.applyInspectionResult(snapshot.sessionId, "focused");
    expect(service.getActive()?.phase).toBe("feedback");

    vi.advanceTimersByTime(4_999);
    expect(service.getActive()?.phase).toBe("feedback");
    vi.advanceTimersByTime(1);
    expect(service.getActive()?.phase).toBe("focusing");

    expect(service.completeFeedback(snapshot.sessionId).phase).toBe("focusing");
    service.dispose();
  });

  it("keeps final feedback waiting for an explicit settlement choice", () => {
    vi.useFakeTimers();
    const { service, snapshot } = startService((current) => current.phase === "feedback"
      ? { ...current, focusedSeconds: current.plannedSeconds, plannedReached: true }
      : current);

    service.previewPatrol(snapshot.sessionId);
    service.applyInspectionResult(snapshot.sessionId, "focused");
    vi.advanceTimersByTime(10_000);

    expect(service.getActive()?.phase).toBe("feedback");
    expect(service.getActive()?.plannedReached).toBe(true);
    service.dispose();
  });
});
