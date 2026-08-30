import type { ObservationReasonCode } from "./inspection.js";
import {
  DEFAULT_PRIVATE_COMMUNICATION_POLICY,
  type ObservationLabel,
  type PrivateCommunicationPolicy,
} from "./session.js";

export const INSPECTION_POLICY_VERSION = "1.0.0" as const;

export interface VisionPolicyDecision {
  label: ObservationLabel;
  confidence: number;
  reasonCode: ObservationReasonCode;
}

export type VisionPolicyAdjustment =
  | "none"
  | "private-communication-reminder"
  | "invalid-label-reason-pair";

export interface VisionPolicyResolution {
  decision: VisionPolicyDecision;
  adjustment: VisionPolicyAdjustment;
}

function invalidDecision(): VisionPolicyResolution {
  return {
    decision: {
      label: "uncertain",
      confidence: 0,
      reasonCode: "invalid_response",
    },
    adjustment: "invalid-label-reason-pair",
  };
}

/**
 * 对结构上合法的模型响应执行产品语义校验。
 * 提示词不是安全边界；即使模型违背提示，也只能由本函数决定是否允许进入处罚流程。
 */
export function enforceVisionDecisionPolicy(
  raw: VisionPolicyDecision,
  privateCommunicationPolicy: PrivateCommunicationPolicy = DEFAULT_PRIVATE_COMMUNICATION_POLICY,
): VisionPolicyResolution {
  if (raw.reasonCode === "task_related_content") {
    return raw.label === "focused"
      ? { decision: raw, adjustment: "none" }
      : invalidDecision();
  }

  if (raw.reasonCode === "entertainment_content") {
    return raw.label === "distracted"
      ? { decision: raw, adjustment: "none" }
      : invalidDecision();
  }

  if (raw.reasonCode === "private_communication") {
    if (raw.label === "focused") return invalidDecision();
    if (privateCommunicationPolicy === "remind") {
      return {
        decision: { ...raw, label: "uncertain" },
        adjustment: "private-communication-reminder",
      };
    }
    return { decision: raw, adjustment: "none" };
  }

  if (raw.reasonCode === "insufficient_evidence") {
    return raw.label === "uncertain"
      ? { decision: raw, adjustment: "none" }
      : invalidDecision();
  }

  // 本地规则和基础设施原因码不允许由远程模型伪造。
  return invalidDecision();
}
