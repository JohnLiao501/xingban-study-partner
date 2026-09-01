import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createSession } from "../../shared/session-engine.js";
import type { SessionSnapshot } from "../../shared/session.js";
import { XingbanDatabase } from "../storage/database.js";
import {
  auditStage3AcceptanceDirectory,
  evaluateStage3AcceptanceRunOutcome,
  readStage3AcceptanceDatabaseEvidence,
  removeStage3AcceptanceDirectory,
} from "./stage3-evidence.js";

const roots: string[] = [];

function createRoot(): { tempRoot: string; acceptanceRoot: string } {
  const tempRoot = mkdtempSync(path.join(os.tmpdir(), "xingban-stage3-evidence-test-"));
  roots.push(tempRoot);
  const acceptanceRoot = mkdtempSync(path.join(tempRoot, "xingban-stage3-acceptance-"));
  return { tempRoot, acceptanceRoot };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("stage 3 acceptance evidence", () => {
  it("summarizes the isolated database without returning goals, app names, titles or keys", () => {
    const { acceptanceRoot } = createRoot();
    const databasePath = path.join(acceptanceRoot, "xingban.sqlite3");
    const database = new XingbanDatabase(databasePath);
    const base = createSession({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "sensitive goal",
      plannedMinutes: 25,
    }, { sessionId: "acceptance-session", seed: 7 });
    const completed: SessionSnapshot = {
      ...base,
      phase: "completed",
      focusedSeconds: 1500,
      deviationCount: 2,
      outcome: { mode: "completed", completionRatio: 1, grade: "B", trustGained: 29 },
    };
    database.saveSession(base);
    for (const observation of [
      ["2026-08-31T00:00:00.000Z", "focused", "allowed_app", "local-rule", 1, false],
      ["2026-08-31T00:00:01.000Z", "distracted", "blocked_app", "local-rule", 1, true],
      ["2026-08-31T00:00:02.000Z", "focused", "task_related_content", "vision-api", 0.92, false],
      ["2026-08-31T00:00:03.000Z", "uncertain", "private_communication", "vision-api", 0.94, false],
      ["2026-08-31T00:00:04.000Z", "uncertain", "entertainment_content", "vision-api", 0.93, false],
      ["2026-08-31T00:00:19.000Z", "distracted", "entertainment_content", "vision-api", 0.95, true],
      ["2026-08-31T00:00:20.000Z", "uncertain", "capture_unavailable", "fallback", 0, false],
      ["2026-08-31T00:00:21.000Z", "focused", "task_related_content", "vision-api", 0.91, false],
    ] as const) {
      database.recordStructuredObservation({
        sessionId: base.sessionId,
        observedAt: observation[0],
        label: observation[1],
        confidence: observation[4],
        source: observation[3],
        reasonCode: observation[2],
        appName: "sensitive-app",
        windowTitleHash: "a".repeat(64),
        confirmedDeviation: observation[5],
      });
    }
    database.finalizeSession(completed, () => "initial");
    database.close();

    const evidence = readStage3AcceptanceDatabaseEvidence(databasePath);
    expect(evidence.pass).toBe(true);
    const serialized = JSON.stringify(evidence);
    expect(serialized).not.toContain("sensitive goal");
    expect(serialized).not.toContain("sensitive-app");
    expect(serialized).not.toContain("acceptance-session");
    expect(evidence).toMatchObject({
      observationCount: 8,
      expectedObservationSequence: true,
      secondFrameDelayMs: 15_000,
      partnerProgressCount: 1,
      totalTrust: 29,
      blobValueCount: 0,
    });
  });

  it("detects image/data-image residue and removes only the validated exact directory", async () => {
    const { tempRoot, acceptanceRoot } = createRoot();
    writeFileSync(path.join(acceptanceRoot, "safe.txt"), "structured summary only");
    expect((await auditStage3AcceptanceDirectory(acceptanceRoot, tempRoot)).pass).toBe(true);

    writeFileSync(path.join(acceptanceRoot, "inspection.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
    writeFileSync(path.join(acceptanceRoot, "leak.txt"), "data:image/jpeg;base64,/9j/" + "A".repeat(200));
    writeFileSync(path.join(acceptanceRoot, "large-leak.bin"), Buffer.concat([
      Buffer.alloc(9 * 1024 * 1024, 0x20),
      Buffer.from("xingban-stage3-local-mock"),
    ]));
    const failed = await auditStage3AcceptanceDirectory(acceptanceRoot, tempRoot);
    expect(failed.pass).toBe(false);
    expect(failed.imageFileCount).toBeGreaterThan(0);
    expect(failed.dataImageMatchCount).toBe(1);
    expect(failed.mockTokenMatchCount).toBe(1);
    expect(failed.scannedByteCount).toBeGreaterThan(9 * 1024 * 1024);

    expect(await removeStage3AcceptanceDirectory(acceptanceRoot, tempRoot)).toBe(true);

    const passingOutcome = {
      childExitCode: 0,
      interrupted: false,
      databasePass: true,
      privacyPass: true,
      cleanupPass: true,
      processCleanupPass: true,
      tracePass: true,
      mockRequestCount: 5,
      mockScenarioRequestCount: 5,
      mockRemainingSteps: 0,
      mockInvalidRequestCount: 0,
    };
    expect(evaluateStage3AcceptanceRunOutcome(passingOutcome)).toBe(true);
    for (const failure of [
      { childExitCode: 1 },
      { interrupted: true },
      { databasePass: false },
      { privacyPass: false },
      { cleanupPass: false },
      { processCleanupPass: false },
      { tracePass: false },
      { mockRequestCount: 6 },
      { mockScenarioRequestCount: 4 },
      { mockRemainingSteps: 1 },
      { mockInvalidRequestCount: 1 },
    ]) {
      expect(evaluateStage3AcceptanceRunOutcome({ ...passingOutcome, ...failure })).toBe(false);
    }
  });
});
