import {
  INPUT_LIMITS,
  InspectionValidationError,
  type SaveVisionSettingsInput,
} from "./inspection.js";
import type { SaveAppRuleInput } from "./rules.js";
import type { StartSessionInput } from "./session.js";

const PARTNER_ID_MAX_LENGTH = 120;
const SCENE_ID_MAX_LENGTH = 120;
const PACK_VERSION_MAX_LENGTH = 40;
const CAPTURE_SOURCE_ID_MAX_LENGTH = 500;
const RULE_ID_MAX_LENGTH = 100;
const API_KEY_MAX_LENGTH = 4096;

function requireRecord(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InspectionValidationError("输入必须是对象");
  }
  return input as Record<string, unknown>;
}

function requireExactKeys(
  record: Record<string, unknown>,
  required: readonly string[],
  optional: readonly string[] = [],
): void {
  const allowed = new Set([...required, ...optional]);
  const keys = Object.keys(record);
  if (!required.every((key) => keys.includes(key)) || !keys.every((key) => allowed.has(key))) {
    throw new InspectionValidationError("包含额外或缺失的字段");
  }
}

function requireString(value: unknown, label: string, maxLength: number): string {
  if (typeof value !== "string") throw new InspectionValidationError(`${label} 必须是字符串`);
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new InspectionValidationError(`${label} 长度无效`);
  }
  return normalized;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new InspectionValidationError(`${key} 必须是布尔值`);
  return value;
}

function optionalStringArray(record: Record<string, unknown>, key: string): string[] | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (!Array.isArray(value) || value.length > INPUT_LIMITS.MAX_RULES_PER_SESSION) {
    throw new InspectionValidationError(`${key} 必须是数量受限的字符串数组`);
  }
  const normalized = value.map((item) => requireString(item, key, RULE_ID_MAX_LENGTH));
  if (new Set(normalized).size !== normalized.length) {
    throw new InspectionValidationError(`${key} 不得包含重复 ID`);
  }
  return normalized;
}

export function validateStartSessionInput(input: unknown): StartSessionInput {
  const record = requireRecord(input);
  requireExactKeys(
    record,
    ["partnerId", "packVersion", "sceneId", "goal", "plannedMinutes"],
    ["captureSourceId", "visionEnabled", "sendWindowTitle", "allowRuleIds", "blockRuleIds"],
  );

  if (!Number.isInteger(record.plannedMinutes) ||
      (record.plannedMinutes as number) < 10 ||
      (record.plannedMinutes as number) > 180) {
    throw new InspectionValidationError("plannedMinutes 必须是 10 到 180 的整数");
  }

  const captureSourceId = record.captureSourceId === undefined
    ? undefined
    : requireString(record.captureSourceId, "captureSourceId", CAPTURE_SOURCE_ID_MAX_LENGTH);

  return {
    partnerId: requireString(record.partnerId, "partnerId", PARTNER_ID_MAX_LENGTH),
    packVersion: requireString(record.packVersion, "packVersion", PACK_VERSION_MAX_LENGTH),
    sceneId: requireString(record.sceneId, "sceneId", SCENE_ID_MAX_LENGTH),
    goal: requireString(record.goal, "goal", INPUT_LIMITS.GOAL_MAX_LENGTH),
    plannedMinutes: record.plannedMinutes as number,
    ...(captureSourceId ? { captureSourceId } : {}),
    ...(record.visionEnabled !== undefined ? { visionEnabled: optionalBoolean(record, "visionEnabled") } : {}),
    ...(record.sendWindowTitle !== undefined ? { sendWindowTitle: optionalBoolean(record, "sendWindowTitle") } : {}),
    ...(record.allowRuleIds !== undefined ? { allowRuleIds: optionalStringArray(record, "allowRuleIds") } : {}),
    ...(record.blockRuleIds !== undefined ? { blockRuleIds: optionalStringArray(record, "blockRuleIds") } : {}),
  };
}

export function validateVisionBaseUrl(value: unknown): string {
  const raw = requireString(value, "baseUrl", INPUT_LIMITS.API_BASE_URL_MAX_LENGTH);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new InspectionValidationError("baseUrl 不是有效 URL");
  }

  if (parsed.username || parsed.password || parsed.hash || parsed.search) {
    throw new InspectionValidationError("baseUrl 不得包含凭据、查询参数或片段");
  }

  const localHttp = parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost" || parsed.hostname === "[::1]");
  if (parsed.protocol !== "https:" && !localHttp) {
    throw new InspectionValidationError("baseUrl 仅允许 HTTPS 或本机 HTTP 开发地址");
  }
  return parsed.toString().replace(/\/$/, "");
}

export function validateSaveVisionSettingsInput(input: unknown): SaveVisionSettingsInput {
  const record = requireRecord(input);
  requireExactKeys(
    record,
    ["baseUrl", "model", "sendWindowTitle", "visionEnabled", "timeoutMs"],
    ["apiKey", "clearApiKey"],
  );

  if (typeof record.sendWindowTitle !== "boolean" || typeof record.visionEnabled !== "boolean") {
    throw new InspectionValidationError("视觉开关必须是布尔值");
  }
  if (!Number.isInteger(record.timeoutMs) ||
      (record.timeoutMs as number) < 2_000 ||
      (record.timeoutMs as number) > 60_000) {
    throw new InspectionValidationError("timeoutMs 必须是 2000 到 60000 的整数");
  }
  if (record.apiKey !== undefined && typeof record.apiKey !== "string") {
    throw new InspectionValidationError("apiKey 必须是字符串");
  }
  if (typeof record.apiKey === "string" && record.apiKey.length > API_KEY_MAX_LENGTH) {
    throw new InspectionValidationError("apiKey 长度超出限制");
  }
  if (record.clearApiKey !== undefined && typeof record.clearApiKey !== "boolean") {
    throw new InspectionValidationError("clearApiKey 必须是布尔值");
  }
  if (record.clearApiKey === true && typeof record.apiKey === "string" && record.apiKey.trim()) {
    throw new InspectionValidationError("不能同时设置和清除 apiKey");
  }

  return {
    baseUrl: validateVisionBaseUrl(record.baseUrl),
    model: requireString(record.model, "model", INPUT_LIMITS.MODEL_NAME_MAX_LENGTH),
    ...(typeof record.apiKey === "string" && record.apiKey.trim()
      ? { apiKey: record.apiKey.trim() }
      : {}),
    ...(record.clearApiKey === true ? { clearApiKey: true } : {}),
    sendWindowTitle: record.sendWindowTitle,
    visionEnabled: record.visionEnabled,
    timeoutMs: record.timeoutMs as number,
  };
}

export function validateSaveAppRuleInput(input: unknown): SaveAppRuleInput {
  const record = requireRecord(input);
  requireExactKeys(record, ["matchType", "pattern", "decision", "enabled"], ["id"]);
  if (record.matchType !== "process" && record.matchType !== "window-title") {
    throw new InspectionValidationError("matchType 无效");
  }
  if (record.decision !== "allow" && record.decision !== "block") {
    throw new InspectionValidationError("decision 无效");
  }
  if (typeof record.enabled !== "boolean") {
    throw new InspectionValidationError("enabled 必须是布尔值");
  }
  const id = record.id === undefined ? undefined : requireString(record.id, "id", RULE_ID_MAX_LENGTH);
  return {
    ...(id ? { id } : {}),
    matchType: record.matchType,
    pattern: requireString(record.pattern, "pattern", INPUT_LIMITS.RULE_PATTERN_MAX_LENGTH),
    decision: record.decision,
    enabled: record.enabled,
  };
}
