import { existsSync, realpathSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StartSessionInput, SessionSnapshot } from "../../shared/session.js";
import {
  applyStage3AcceptancePatrolSchedule,
  createStage3AcceptancePlanView,
  STAGE3_ACCEPTANCE_RULE_IDS,
  STAGE3_ACCEPTANCE_SEED,
  type Stage3AcceptancePlanView,
} from "../../shared/stage3-acceptance.js";

const ACCEPTANCE_DIRECTORY_PREFIX = "xingban-stage3-acceptance-";
const PROCESS_NAME_PATTERN = /^[^\\/:*?"<>|\r\n]{1,120}$/;

export const STAGE3_ACCEPTANCE_MOCK_TOKEN = "xingban-stage3-local-mock";

export { STAGE3_ACCEPTANCE_RULE_IDS } from "../../shared/stage3-acceptance.js";

export interface Stage3AcceptanceRuntimeConfig {
  userDataPath: string;
  mockBaseUrl: string;
  mockApiToken: string;
  plan: Stage3AcceptancePlanView;
  seed: number;
}

function comparableWindowsPath(value: string): string {
  return process.platform === "win32" ? value.toLocaleLowerCase("en-US") : value;
}

export function resolveAcceptanceDirectory(
  candidatePath: string,
  tempRoot = os.tmpdir(),
): string {
  if (!candidatePath || !path.isAbsolute(candidatePath) || !existsSync(candidatePath)) {
    throw new Error("ACCEPTANCE_USER_DATA_INVALID");
  }
  const resolvedRoot = realpathSync(path.resolve(tempRoot));
  const resolvedCandidate = realpathSync(path.resolve(candidatePath));
  const candidateParent = comparableWindowsPath(path.dirname(resolvedCandidate));
  const expectedParent = comparableWindowsPath(resolvedRoot);
  if (
    candidateParent !== expectedParent ||
    !path.basename(resolvedCandidate).startsWith(ACCEPTANCE_DIRECTORY_PREFIX)
  ) {
    throw new Error("ACCEPTANCE_USER_DATA_OUTSIDE_TEMP");
  }
  return resolvedCandidate;
}

export function validateAcceptanceMockBaseUrl(value: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("ACCEPTANCE_MOCK_URL_INVALID");
  }
  if (
    parsed.protocol !== "http:" ||
    parsed.hostname !== "127.0.0.1" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    !parsed.port
  ) {
    throw new Error("ACCEPTANCE_MOCK_URL_INVALID");
  }
  parsed.pathname = parsed.pathname.replace(/\/+$/, "") || "/v1";
  return parsed.toString().replace(/\/$/, "");
}

function processName(value: string | undefined, fallback: string): string {
  const normalized = value?.trim() || fallback;
  if (!PROCESS_NAME_PATTERN.test(normalized)) {
    throw new Error("ACCEPTANCE_PROCESS_NAME_INVALID");
  }
  return normalized;
}

export function loadStage3AcceptanceRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
  tempRoot = os.tmpdir(),
): Stage3AcceptanceRuntimeConfig | null {
  if (environment.XINGBAN_STAGE3_ACCEPTANCE !== "1") return null;
  const userDataPath = resolveAcceptanceDirectory(
    environment.XINGBAN_ACCEPTANCE_USER_DATA ?? "",
    tempRoot,
  );
  const mockBaseUrl = validateAcceptanceMockBaseUrl(
    environment.XINGBAN_ACCEPTANCE_MOCK_BASE_URL ?? "",
  );
  const allowProcessName = processName(environment.XINGBAN_ACCEPTANCE_ALLOW_PROCESS, "notepad");
  const blockProcessName = processName(environment.XINGBAN_ACCEPTANCE_BLOCK_PROCESS, "mspaint");
  return {
    userDataPath,
    mockBaseUrl,
    mockApiToken: STAGE3_ACCEPTANCE_MOCK_TOKEN,
    plan: createStage3AcceptancePlanView(allowProcessName, blockProcessName),
    seed: STAGE3_ACCEPTANCE_SEED,
  };
}

export function validateStage3AcceptanceStart(input: StartSessionInput): void {
  if (
    input.partnerId !== "demo-guardian" ||
    input.packVersion !== "1.0.0" ||
    input.sceneId !== "quiet-observatory" ||
    input.plannedMinutes !== 25 ||
    !input.captureSourceId ||
    input.visionEnabled !== true ||
    input.sendWindowTitle !== false ||
    input.privateCommunicationPolicy !== "remind" ||
    input.allowRuleIds?.length !== 1 ||
    input.allowRuleIds[0] !== STAGE3_ACCEPTANCE_RULE_IDS.allow ||
    input.blockRuleIds?.length !== 1 ||
    input.blockRuleIds[0] !== STAGE3_ACCEPTANCE_RULE_IDS.block
  ) {
    throw new Error("ACCEPTANCE_SESSION_CONFIGURATION_INVALID");
  }
}

export function normalizeStage3AcceptanceSnapshot(
  snapshot: SessionSnapshot,
  plan: Stage3AcceptancePlanView,
): SessionSnapshot {
  return applyStage3AcceptancePatrolSchedule(snapshot, plan.patrolSeconds);
}
