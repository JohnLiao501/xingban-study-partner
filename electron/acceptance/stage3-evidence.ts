import { open, readdir, rm } from "node:fs/promises";
import { createReadStream, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { resolveAcceptanceDirectory } from "./stage3-environment.js";

const IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const IMAGE_SIGNATURES = [
  Buffer.from([0xff, 0xd8, 0xff]),
  Buffer.from([0x89, 0x50, 0x4e, 0x47]),
  Buffer.from("RIFF"),
];

export interface Stage3DatabaseEvidence {
  sessionCount: number;
  phase: string | null;
  plannedSeconds: number;
  focusedSeconds: number;
  deviationCount: number;
  grade: string | null;
  trustGained: number;
  progressApplied: boolean;
  partnerProgressCount: number;
  totalTrust: number;
  observationCount: number;
  expectedObservationSequence: boolean;
  secondFrameDelayMs: number;
  confirmedDeviationCount: number;
  blockedDeviationCount: number;
  entertainmentDeviationCount: number;
  unsafePrivateCommunicationCount: number;
  unsafeCaptureUnavailableCount: number;
  blobValueCount: number;
  pass: boolean;
}

export interface Stage3PrivacyAudit {
  scannedFileCount: number;
  imageFileCount: number;
  dataImageMatchCount: number;
  jpegBase64MatchCount: number;
  symbolicLinkCount: number;
  mockTokenMatchCount: number;
  scannedByteCount: number;
  pass: boolean;
}

export interface Stage3RunOutcomeInput {
  childExitCode: number;
  interrupted: boolean;
  databasePass: boolean;
  privacyPass: boolean;
  cleanupPass: boolean;
  processCleanupPass: boolean;
  tracePass: boolean;
  mockRequestCount: number;
  mockScenarioRequestCount: number;
  mockRemainingSteps: number;
  mockInvalidRequestCount: number;
}

export function evaluateStage3AcceptanceRunOutcome(input: Stage3RunOutcomeInput): boolean {
  return input.childExitCode === 0 &&
    !input.interrupted &&
    input.databasePass &&
    input.privacyPass &&
    input.cleanupPass &&
    input.processCleanupPass &&
    input.tracePass &&
    input.mockRequestCount === 5 &&
    input.mockScenarioRequestCount === 5 &&
    input.mockRemainingSteps === 0 &&
    input.mockInvalidRequestCount === 0;
}

function imageSignature(buffer: Buffer): boolean {
  if (buffer.subarray(0, 4).equals(IMAGE_SIGNATURES[2]!)) {
    return buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  return IMAGE_SIGNATURES.slice(0, 2).some((signature) => (
    buffer.subarray(0, signature.length).equals(signature)
  ));
}

export function readStage3AcceptanceDatabaseEvidence(databasePath: string): Stage3DatabaseEvidence {
  if (!existsSync(databasePath)) {
    return {
      sessionCount: 0,
      phase: null,
      plannedSeconds: 0,
      focusedSeconds: 0,
      deviationCount: 0,
      grade: null,
      trustGained: 0,
      progressApplied: false,
      partnerProgressCount: 0,
      totalTrust: 0,
      observationCount: 0,
      expectedObservationSequence: false,
      secondFrameDelayMs: 0,
      confirmedDeviationCount: 0,
      blockedDeviationCount: 0,
      entertainmentDeviationCount: 0,
      unsafePrivateCommunicationCount: 0,
      unsafeCaptureUnavailableCount: 0,
      blobValueCount: 0,
      pass: false,
    };
  }

  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const sessionCount = Number((database.prepare("SELECT COUNT(*) AS count FROM sessions").get() as { count: number }).count);
    const session = database.prepare(`
      SELECT id, phase, planned_seconds, focused_seconds, deviation_count, grade,
             trust_gained, progress_applied
      FROM sessions
      ORDER BY ended_at DESC, checkpoint_at DESC
      LIMIT 1
    `).get() as {
      id: string;
      phase: string;
      planned_seconds: number;
      focused_seconds: number;
      deviation_count: number;
      grade: string | null;
      trust_gained: number;
      progress_applied: number;
    } | undefined;
    const observations = database.prepare(`
      SELECT observed_at, label, confidence, source, reason_code, confirmed_deviation
      FROM observations
      WHERE session_id = ?
      ORDER BY observed_at ASC
    `).all(session?.id ?? "") as unknown as Array<{
      observed_at: string;
      label: string;
      confidence: number;
      source: string;
      reason_code: string;
      confirmed_deviation: number;
    }>;

    const progress = database.prepare(`
      SELECT COUNT(*) AS count, COALESCE(MAX(total_trust), 0) AS total_trust
      FROM partner_progress
    `).get() as { count: number; total_trust: number };

    const expected = [
      ["focused", "allowed_app", "local-rule", 0],
      ["distracted", "blocked_app", "local-rule", 1],
      ["focused", "task_related_content", "vision-api", 0],
      ["uncertain", "private_communication", "vision-api", 0],
      ["uncertain", "entertainment_content", "vision-api", 0],
      ["distracted", "entertainment_content", "vision-api", 1],
      ["uncertain", "capture_unavailable", "fallback", 0],
      ["focused", "task_related_content", "vision-api", 0],
    ] as const;
    const expectedObservationSequence = observations.length === expected.length &&
      observations.every((row, index) => {
        const item = expected[index]!;
        const confidenceValid = row.source === "vision-api"
          ? row.confidence >= 0.8
          : row.source === "local-rule"
            ? row.confidence === 1
            : row.confidence === 0;
        return row.label === item[0] &&
          row.reason_code === item[1] &&
          row.source === item[2] &&
          row.confirmed_deviation === item[3] &&
          confidenceValid;
      });
    const firstEntertainmentAt = Date.parse(observations[4]?.observed_at ?? "");
    const confirmedEntertainmentAt = Date.parse(observations[5]?.observed_at ?? "");
    const secondFrameDelayMs = Number.isFinite(firstEntertainmentAt) && Number.isFinite(confirmedEntertainmentAt)
      ? confirmedEntertainmentAt - firstEntertainmentAt
      : 0;

    let blobValueCount = 0;
    const tables = database.prepare(`
      SELECT name FROM sqlite_schema
      WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
    `).all() as unknown as Array<{ name: string }>;
    for (const { name } of tables) {
      const quotedTable = `"${name.replaceAll('"', '""')}"`;
      const columns = database.prepare(`PRAGMA table_info(${quotedTable})`).all() as unknown as Array<{ name: string }>;
      for (const column of columns) {
        const quotedColumn = `"${column.name.replaceAll('"', '""')}"`;
        const row = database.prepare(
          `SELECT COUNT(*) AS count FROM ${quotedTable} WHERE typeof(${quotedColumn}) = 'blob'`,
        ).get() as { count: number };
        blobValueCount += Number(row.count);
      }
    }

    const confirmedDeviationCount = observations.filter((row) => row.confirmed_deviation === 1).length;
    const blockedDeviationCount = observations.filter((row) => (
      row.reason_code === "blocked_app" && row.confirmed_deviation === 1
    )).length;
    const entertainmentDeviationCount = observations.filter((row) => (
      row.reason_code === "entertainment_content" && row.confirmed_deviation === 1
    )).length;
    const unsafePrivateCommunicationCount = observations.filter((row) => (
      row.reason_code === "private_communication" &&
      (row.label !== "uncertain" || row.confirmed_deviation !== 0)
    )).length;
    const unsafeCaptureUnavailableCount = observations.filter((row) => (
      row.reason_code === "capture_unavailable" &&
      (row.label !== "uncertain" || row.confirmed_deviation !== 0)
    )).length;

    const evidence: Stage3DatabaseEvidence = {
      sessionCount,
      phase: session?.phase ?? null,
      plannedSeconds: session?.planned_seconds ?? 0,
      focusedSeconds: session?.focused_seconds ?? 0,
      deviationCount: session?.deviation_count ?? 0,
      grade: session?.grade ?? null,
      trustGained: session?.trust_gained ?? 0,
      progressApplied: session?.progress_applied === 1,
      partnerProgressCount: Number(progress.count),
      totalTrust: Number(progress.total_trust),
      observationCount: observations.length,
      expectedObservationSequence,
      secondFrameDelayMs,
      confirmedDeviationCount,
      blockedDeviationCount,
      entertainmentDeviationCount,
      unsafePrivateCommunicationCount,
      unsafeCaptureUnavailableCount,
      blobValueCount,
      pass: false,
    };
    evidence.pass = Boolean(
      sessionCount === 1 &&
      evidence.phase === "completed" &&
      evidence.plannedSeconds === 1500 &&
      evidence.focusedSeconds === 1500 &&
      evidence.deviationCount === 2 &&
      evidence.grade === "B" &&
      evidence.trustGained === 29 &&
      evidence.progressApplied &&
      evidence.partnerProgressCount === 1 &&
      evidence.totalTrust === 29 &&
      evidence.observationCount === 8 &&
      evidence.expectedObservationSequence &&
      evidence.secondFrameDelayMs >= 14_500 &&
      evidence.confirmedDeviationCount === 2 &&
      evidence.blockedDeviationCount === 1 &&
      evidence.entertainmentDeviationCount === 1 &&
      evidence.unsafePrivateCommunicationCount === 0 &&
      evidence.unsafeCaptureUnavailableCount === 0 &&
      evidence.blobValueCount === 0
    );
    return evidence;
  } finally {
    database.close();
  }
}

async function scanAuditFile(filePath: string): Promise<{
  byteCount: number;
  hasImageSignature: boolean;
  hasDataImage: boolean;
  hasJpegBase64: boolean;
  hasMockToken: boolean;
}> {
  const handle = await open(filePath, "r");
  const header = Buffer.alloc(12);
  try {
    await handle.read(header, 0, header.length, 0);
  } finally {
    await handle.close();
  }

  let byteCount = 0;
  let tail = "";
  let hasDataImage = false;
  let hasJpegBase64 = false;
  let hasMockToken = false;
  for await (const rawChunk of createReadStream(filePath, { highWaterMark: 64 * 1024 })) {
    const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
    byteCount += chunk.byteLength;
    const text = tail + chunk.toString("latin1");
    hasDataImage ||= /data:image\/[a-z0-9.+-]+;base64,/i.test(text);
    hasJpegBase64 ||= /\/9j\/[A-Za-z0-9+/=]{128,}/.test(text);
    hasMockToken ||= text.includes("xingban-stage3-local-mock");
    tail = text.slice(-512);
    chunk.fill(0);
  }
  const hasImageSignature = imageSignature(header);
  header.fill(0);
  return {
    byteCount,
    hasImageSignature,
    hasDataImage,
    hasJpegBase64,
    hasMockToken,
  };
}

async function collectFiles(
  rootPath: string,
): Promise<{ files: string[]; symbolicLinkCount: number }> {
  const files: string[] = [];
  let symbolicLinkCount = 0;
  const pending = [rootPath];
  while (pending.length > 0) {
    const current = pending.pop()!;
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isSymbolicLink()) {
        symbolicLinkCount += 1;
      } else if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile()) {
        files.push(entryPath);
      }
    }
  }
  return { files, symbolicLinkCount };
}

export async function auditStage3AcceptanceDirectory(
  directoryPath: string,
  tempRoot = os.tmpdir(),
): Promise<Stage3PrivacyAudit> {
  const rootPath = resolveAcceptanceDirectory(directoryPath, tempRoot);
  const { files, symbolicLinkCount } = await collectFiles(rootPath);
  let imageFileCount = 0;
  let dataImageMatchCount = 0;
  let jpegBase64MatchCount = 0;
  let mockTokenMatchCount = 0;
  let scannedByteCount = 0;

  for (const filePath of files) {
    const extension = path.extname(filePath).toLowerCase();
    const result = await scanAuditFile(filePath);
    scannedByteCount += result.byteCount;
    if (IMAGE_EXTENSIONS.has(extension) || result.hasImageSignature) imageFileCount += 1;
    if (result.hasDataImage) dataImageMatchCount += 1;
    if (result.hasJpegBase64) jpegBase64MatchCount += 1;
    if (result.hasMockToken) mockTokenMatchCount += 1;
  }

  return {
    scannedFileCount: files.length,
    imageFileCount,
    dataImageMatchCount,
    jpegBase64MatchCount,
    symbolicLinkCount,
    mockTokenMatchCount,
    scannedByteCount,
    pass: imageFileCount === 0 &&
      dataImageMatchCount === 0 &&
      jpegBase64MatchCount === 0 &&
      symbolicLinkCount === 0 &&
      mockTokenMatchCount === 0,
  };
}

export async function removeStage3AcceptanceDirectory(
  directoryPath: string,
  tempRoot = os.tmpdir(),
): Promise<boolean> {
  const resolved = resolveAcceptanceDirectory(directoryPath, tempRoot);
  await rm(resolved, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  return !existsSync(resolved);
}
