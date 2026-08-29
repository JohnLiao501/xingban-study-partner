import type { ObservationLabel } from "./session.js";

export interface ForegroundSample {
  capturedAt: string;   // ISO 8601 UTC
  processName: string;  // 进程名，如 "code"
  windowTitle: string;  // 窗口标题
  pid: number;          // 进程 ID
}

export const OBSERVATION_REASON_CODES = [
  "allowed_app",
  "blocked_app",
  "task_related_content",
  "entertainment_content",
  "private_communication",
  "insufficient_evidence",
  "capture_unavailable",
  "api_unavailable",
  "invalid_response",
] as const;
export type ObservationReasonCode = (typeof OBSERVATION_REASON_CODES)[number];

export const INSPECTION_SOURCES = ["local-rule", "vision-api", "fallback"] as const;
export type InspectionSource = (typeof INSPECTION_SOURCES)[number];

export interface InspectionResult {
  label: ObservationLabel;
  confidence: number;       // 0~1
  reasonCode: ObservationReasonCode;
  source: InspectionSource;
  appName: string | null;
  windowTitleHash: string | null; // SHA-256哈希，不存原文
  latencyMs: number;
  errorCode: string | null;
}

export const CAPTURE_STATUSES = ["inactive", "active", "stopped", "failed"] as const;
export type CaptureStatus = (typeof CAPTURE_STATUSES)[number];

export interface VisionSettingsView {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean; // 只告知是否已配置，不返回密钥
  sendWindowTitle: boolean;
  visionEnabled: boolean;
  timeoutMs: number;
}

export const PROBE_STATUSES = ["stopped", "running", "unavailable", "restarting"] as const;
export type ForegroundProbeStatus = (typeof PROBE_STATUSES)[number];

export const INPUT_LIMITS = {
  GOAL_MAX_LENGTH: 500,
  PROCESS_NAME_MAX_LENGTH: 260,
  WINDOW_TITLE_MAX_LENGTH: 500,
  MAX_RULES_PER_SESSION: 100,
  RULE_PATTERN_MAX_LENGTH: 260,
  API_BASE_URL_MAX_LENGTH: 2048,
  MODEL_NAME_MAX_LENGTH: 200,
} as const;

export class InspectionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InspectionValidationError";
  }
}

/** 校验 ForegroundSample，拒绝额外字段、超长值、负 PID */
export function validateForegroundSample(input: unknown): ForegroundSample {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InspectionValidationError("输入必须是一个对象");
  }

  const record = input as Record<string, unknown>;
  const allowedKeys = ["capturedAt", "processName", "windowTitle", "pid"];
  const keys = Object.keys(record);
  if (keys.length !== allowedKeys.length || !keys.every((k) => allowedKeys.includes(k))) {
    throw new InspectionValidationError("包含额外或缺失的字段");
  }

  if (typeof record.capturedAt !== "string") {
    throw new InspectionValidationError("capturedAt 必须是字符串");
  }
  if (typeof record.processName !== "string") {
    throw new InspectionValidationError("processName 必须是字符串");
  }
  if (record.processName.length > INPUT_LIMITS.PROCESS_NAME_MAX_LENGTH) {
    throw new InspectionValidationError("processName 长度超出限制");
  }
  if (typeof record.windowTitle !== "string") {
    throw new InspectionValidationError("windowTitle 必须是字符串");
  }
  if (record.windowTitle.length > INPUT_LIMITS.WINDOW_TITLE_MAX_LENGTH) {
    throw new InspectionValidationError("windowTitle 长度超出限制");
  }
  if (typeof record.pid !== "number" || record.pid < 0) {
    throw new InspectionValidationError("pid 必须是大于等于 0 的数字");
  }

  return {
    capturedAt: record.capturedAt,
    processName: record.processName,
    windowTitle: record.windowTitle,
    pid: record.pid,
  };
}

/** 校验 AI 响应 JSON，拒绝额外字段、未知 label/reasonCode、越界置信度 */
export function validateVisionResponse(input: unknown): {
  label: ObservationLabel;
  confidence: number;
  reasonCode: ObservationReasonCode;
} {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new InspectionValidationError("输入必须是一个对象");
  }

  const record = input as Record<string, unknown>;
  const allowedKeys = ["label", "confidence", "reasonCode"];
  const keys = Object.keys(record);
  if (keys.length !== allowedKeys.length || !keys.every((k) => allowedKeys.includes(k))) {
    throw new InspectionValidationError("包含额外或缺失的字段");
  }

  const allowedLabels = ["focused", "uncertain", "distracted"];
  if (typeof record.label !== "string" || !allowedLabels.includes(record.label)) {
    throw new InspectionValidationError("未知的 label");
  }

  if (typeof record.confidence !== "number" || record.confidence < 0 || record.confidence > 1) {
    throw new InspectionValidationError("confidence 必须在 0 到 1 之间");
  }

  if (typeof record.reasonCode !== "string" || !OBSERVATION_REASON_CODES.includes(record.reasonCode as ObservationReasonCode)) {
    throw new InspectionValidationError("未知的 reasonCode");
  }

  return {
    label: record.label as ObservationLabel,
    confidence: record.confidence,
    reasonCode: record.reasonCode as ObservationReasonCode,
  };
}
