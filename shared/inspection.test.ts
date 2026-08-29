/**
 * shared/inspection.ts 运行时校验函数测试
 *
 * 覆盖：合法输入、额外字段、缺失字段、超长值、未知枚举、越界置信度
 */
import { describe, it, expect } from "vitest";
import {
  validateForegroundSample,
  validateVisionResponse,
  InspectionValidationError,
} from "./inspection.js";

describe("validateForegroundSample", () => {
  const validSample = {
    capturedAt: "2026-08-29T08:00:00.000Z",
    processName: "code",
    windowTitle: "study.ts",
    pid: 1234,
  };

  it("接受合法样本", () => {
    const result = validateForegroundSample(validSample);
    expect(result).toEqual(validSample);
  });

  it("拒绝额外字段", () => {
    expect(() =>
      validateForegroundSample({ ...validSample, extra: "hack" }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝缺失字段", () => {
    const { pid: _, ...partial } = validSample;
    expect(() => validateForegroundSample(partial)).toThrow(InspectionValidationError);
  });

  it("拒绝超长 processName", () => {
    expect(() =>
      validateForegroundSample({ ...validSample, processName: "a".repeat(261) }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝超长 windowTitle", () => {
    expect(() =>
      validateForegroundSample({ ...validSample, windowTitle: "a".repeat(501) }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝负 PID", () => {
    expect(() =>
      validateForegroundSample({ ...validSample, pid: -1 }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝 null 输入", () => {
    expect(() => validateForegroundSample(null)).toThrow(InspectionValidationError);
  });

  it("拒绝数组输入", () => {
    expect(() => validateForegroundSample([])).toThrow(InspectionValidationError);
  });

  it("拒绝非对象输入", () => {
    expect(() => validateForegroundSample("string")).toThrow(InspectionValidationError);
  });
});

describe("validateVisionResponse", () => {
  const validResponse = {
    label: "focused",
    confidence: 0.92,
    reasonCode: "task_related_content",
  };

  it("接受合法响应", () => {
    const result = validateVisionResponse(validResponse);
    expect(result).toEqual(validResponse);
  });

  it("接受 focused 0.70 边界", () => {
    const result = validateVisionResponse({ ...validResponse, confidence: 0.70 });
    expect(result.confidence).toBe(0.70);
  });

  it("接受 distracted 0.80 边界", () => {
    const result = validateVisionResponse({
      label: "distracted",
      confidence: 0.80,
      reasonCode: "entertainment_content",
    });
    expect(result.label).toBe("distracted");
  });

  it("拒绝额外字段", () => {
    expect(() =>
      validateVisionResponse({ ...validResponse, extra: "hack" }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝缺失字段", () => {
    const { reasonCode: _, ...partial } = validResponse;
    expect(() => validateVisionResponse(partial)).toThrow(InspectionValidationError);
  });

  it("拒绝未知 label", () => {
    expect(() =>
      validateVisionResponse({ ...validResponse, label: "unknown_label" }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝未知 reasonCode", () => {
    expect(() =>
      validateVisionResponse({ ...validResponse, reasonCode: "made_up_code" }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝 confidence < 0", () => {
    expect(() =>
      validateVisionResponse({ ...validResponse, confidence: -0.1 }),
    ).toThrow(InspectionValidationError);
  });

  it("拒绝 confidence > 1", () => {
    expect(() =>
      validateVisionResponse({ ...validResponse, confidence: 1.1 }),
    ).toThrow(InspectionValidationError);
  });

  it("接受所有合法 reasonCode", () => {
    const codes = [
      "allowed_app", "blocked_app", "task_related_content",
      "entertainment_content", "private_communication",
      "insufficient_evidence", "capture_unavailable",
      "api_unavailable", "invalid_response",
    ];
    for (const code of codes) {
      const result = validateVisionResponse({
        label: "focused",
        confidence: 0.5,
        reasonCode: code,
      });
      expect(result.reasonCode).toBe(code);
    }
  });

  it("拒绝空响应", () => {
    expect(() => validateVisionResponse(null)).toThrow(InspectionValidationError);
  });

  it("拒绝非 JSON 输入", () => {
    expect(() => validateVisionResponse("not json")).toThrow(InspectionValidationError);
  });
});
