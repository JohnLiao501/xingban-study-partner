import { describe, expect, it } from "vitest";
import { enforceVisionDecisionPolicy, INSPECTION_POLICY_VERSION } from "./inspection-policy.js";

describe("inspection policy", () => {
  it("固定策略版本，便于观察记录和验收引用", () => {
    expect(INSPECTION_POLICY_VERSION).toBe("1.0.0");
  });

  it("默认把私人通讯降级为 uncertain 温和提醒", () => {
    const resolution = enforceVisionDecisionPolicy({
      label: "distracted",
      confidence: 0.96,
      reasonCode: "private_communication",
    });

    expect(resolution.decision).toEqual({
      label: "uncertain",
      confidence: 0.96,
      reasonCode: "private_communication",
    });
    expect(resolution.adjustment).toBe("private-communication-reminder");
  });

  it("严格模式允许私人通讯进入 distracted 二次确认", () => {
    const resolution = enforceVisionDecisionPolicy({
      label: "distracted",
      confidence: 0.91,
      reasonCode: "private_communication",
    }, "strict");

    expect(resolution.decision.label).toBe("distracted");
    expect(resolution.adjustment).toBe("none");
  });

  it("拒绝模型伪造本地规则原因码或返回矛盾标签", () => {
    for (const decision of [
      { label: "focused", confidence: 0.9, reasonCode: "entertainment_content" },
      { label: "distracted", confidence: 0.9, reasonCode: "task_related_content" },
      { label: "focused", confidence: 1, reasonCode: "allowed_app" },
    ] as const) {
      const resolution = enforceVisionDecisionPolicy(decision);
      expect(resolution.decision).toEqual({
        label: "uncertain",
        confidence: 0,
        reasonCode: "invalid_response",
      });
      expect(resolution.adjustment).toBe("invalid-label-reason-pair");
    }
  });
});
