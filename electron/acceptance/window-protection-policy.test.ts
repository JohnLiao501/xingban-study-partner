import { describe, expect, it } from "vitest";
import {
  shouldExposeStage3UiAutomation,
  shouldProtectAppWindow,
} from "./window-protection-policy.js";

describe("shouldProtectAppWindow", () => {
  it("正式运行即使收到开发环境变量也保持保护", () => {
    expect(
      shouldProtectAppWindow({
        contentProtectionAcceptanceEnabled: false,
        stage3AcceptanceEnabled: false,
        stage3UiAutomationVisible: true,
      }),
    ).toBe(true);
  });

  it("只在隔离 B1 UI 自动化同时显式请求时关闭", () => {
    expect(
      shouldProtectAppWindow({
        contentProtectionAcceptanceEnabled: false,
        stage3AcceptanceEnabled: true,
        stage3UiAutomationVisible: true,
      }),
    ).toBe(false);
    expect(
      shouldProtectAppWindow({
        contentProtectionAcceptanceEnabled: false,
        stage3AcceptanceEnabled: true,
        stage3UiAutomationVisible: false,
      }),
    ).toBe(true);
  });

  it("保留内容保护专项验收的既有可见启动行为", () => {
    expect(
      shouldProtectAppWindow({
        contentProtectionAcceptanceEnabled: true,
        stage3AcceptanceEnabled: false,
        stage3UiAutomationVisible: false,
      }),
    ).toBe(false);
  });

  it("B2 只在设置和停止共享交互阶段临时显示", () => {
    const visibleAt = (focusedSeconds?: number) => shouldExposeStage3UiAutomation({
      b1ContentProtectionDisabled: false,
      b2ContentProtectionDisabled: true,
      focusedSeconds,
    });

    expect(visibleAt()).toBe(true);
    expect(visibleAt(0)).toBe(true);
    expect(visibleAt(1)).toBe(false);
    expect(visibleAt(839)).toBe(false);
    expect(visibleAt(840)).toBe(true);
    expect(visibleAt(1079)).toBe(true);
    expect(visibleAt(1080)).toBe(false);
    expect(visibleAt(1499)).toBe(false);
    expect(visibleAt(1500)).toBe(true);
  });
});
