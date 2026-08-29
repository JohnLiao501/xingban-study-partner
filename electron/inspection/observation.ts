/**
 * 结构化观察数据与隐私脱敏工具
 *
 * 规范：
 * - 原始窗口标题绝不持久化，仅保留不可逆 SHA-256 哈希值；
 * - 截图二进制数据、base64、模型原始完整响应绝不进入观察数据；
 * - 原因码必须严格属于白名单。
 */

import { createHash } from "node:crypto";
import type {
  InspectionResult,
  InspectionSource,
  ObservationReasonCode,
} from "../../shared/inspection.js";
import type { ObservationLabel } from "../../shared/session.js";

/** 计算窗口标题的不可逆 SHA-256 哈希值（无标题时返回 null） */
export function hashWindowTitle(title: string | null | undefined): string | null {
  if (!title || !title.trim()) {
    return null;
  }
  return createHash("sha256").update(title.trim(), "utf8").digest("hex");
}

/** 结构化持久化观察记录入参 */
export interface CreateStructuredObservationParams {
  sessionId: string;
  observedAt?: string;
  label: ObservationLabel;
  confidence: number;
  source: InspectionSource;
  reasonCode: ObservationReasonCode;
  appName: string | null;
  windowTitleHash: string | null;
  confirmedDeviation: boolean;
}

/** 将 InspectionResult 映射为数据库存储所需的结构化参数 */
export function mapInspectionToObservationParams(
  sessionId: string,
  result: InspectionResult,
  confirmedDeviation: boolean,
): CreateStructuredObservationParams {
  return {
    sessionId,
    observedAt: new Date().toISOString(),
    label: result.label,
    confidence: Math.max(0, Math.min(1, result.confidence)),
    source: result.source,
    reasonCode: result.reasonCode,
    appName: result.appName,
    windowTitleHash: result.windowTitleHash,
    confirmedDeviation,
  };
}
