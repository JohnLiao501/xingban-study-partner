import { describe, expect, it } from "vitest";
import { InspectionValidationError } from "./inspection.js";
import {
  validateSaveAppRuleInput,
  validateSaveVisionSettingsInput,
  validateStartSessionInput,
  validateVisionBaseUrl,
} from "./validation.js";

describe("validateStartSessionInput", () => {
  const valid = {
    partnerId: "demo.partner",
    packVersion: "1.0.0",
    sceneId: "study-room",
    goal: "完成高数练习",
    plannedMinutes: 25,
  };

  it("兼容阶段 2 的最小输入，并规范化字符串", () => {
    expect(validateStartSessionInput({ ...valid, goal: "  完成高数练习  " })).toEqual(valid);
  });

  it("接受完整阶段 3 可选字段", () => {
    const input = {
      ...valid,
      captureSourceId: "screen:1:0",
      visionEnabled: true,
      sendWindowTitle: false,
      allowRuleIds: ["allow-1"],
      blockRuleIds: ["block-1"],
    };
    expect(validateStartSessionInput(input)).toEqual(input);
  });

  it("拒绝额外字段、错误可选类型、重复规则与越界时长", () => {
    expect(() => validateStartSessionInput({ ...valid, extra: true }))
      .toThrow(InspectionValidationError);
    expect(() => validateStartSessionInput({ ...valid, visionEnabled: "yes" }))
      .toThrow(InspectionValidationError);
    expect(() => validateStartSessionInput({ ...valid, allowRuleIds: ["same", "same"] }))
      .toThrow(InspectionValidationError);
    expect(() => validateStartSessionInput({ ...valid, plannedMinutes: 9 }))
      .toThrow(InspectionValidationError);
  });
});

describe("视觉设置校验", () => {
  const valid = {
    baseUrl: "https://api.example.com/v1",
    model: "vision-model",
    sendWindowTitle: false,
    visionEnabled: true,
    timeoutMs: 10_000,
  };

  it("只允许 HTTPS 或本机 HTTP 开发地址", () => {
    expect(validateVisionBaseUrl("https://api.example.com/v1/"))
      .toBe("https://api.example.com/v1");
    expect(validateVisionBaseUrl("http://localhost:8080/v1"))
      .toBe("http://localhost:8080/v1");
    expect(() => validateVisionBaseUrl("http://api.example.com/v1"))
      .toThrow(InspectionValidationError);
    expect(() => validateVisionBaseUrl("file:///tmp/api"))
      .toThrow(InspectionValidationError);
  });

  it("拒绝凭据、查询、片段、额外字段与互斥密钥操作", () => {
    expect(() => validateVisionBaseUrl("https://user:pass@api.example.com/v1"))
      .toThrow(InspectionValidationError);
    expect(() => validateVisionBaseUrl("https://api.example.com/v1?q=1"))
      .toThrow(InspectionValidationError);
    expect(() => validateVisionBaseUrl("https://api.example.com/v1#x"))
      .toThrow(InspectionValidationError);
    expect(() => validateSaveVisionSettingsInput({ ...valid, apiKeyConfigured: true }))
      .toThrow(InspectionValidationError);
    expect(() => validateSaveVisionSettingsInput({
      ...valid,
      apiKey: "sk-new",
      clearApiKey: true,
    })).toThrow(InspectionValidationError);
  });

  it("接受设置、替换或清除密钥的精确输入", () => {
    expect(validateSaveVisionSettingsInput({ ...valid, apiKey: " sk-new " }).apiKey)
      .toBe("sk-new");
    expect(validateSaveVisionSettingsInput({ ...valid, clearApiKey: true }).clearApiKey)
      .toBe(true);
  });
});

describe("validateSaveAppRuleInput", () => {
  const valid = {
    matchType: "process",
    pattern: "Code.exe",
    decision: "allow",
    enabled: true,
  };

  it("接受精确的规则输入", () => {
    expect(validateSaveAppRuleInput(valid)).toEqual(valid);
  });

  it("拒绝额外字段、未知枚举与空模式", () => {
    expect(() => validateSaveAppRuleInput({ ...valid, createdAt: "forged" }))
      .toThrow(InspectionValidationError);
    expect(() => validateSaveAppRuleInput({ ...valid, decision: "maybe" }))
      .toThrow(InspectionValidationError);
    expect(() => validateSaveAppRuleInput({ ...valid, pattern: "   " }))
      .toThrow(InspectionValidationError);
  });
});
