export interface WindowProtectionPolicyInput {
  contentProtectionAcceptanceEnabled: boolean;
  stage3AcceptanceEnabled: boolean;
  stage3UiAutomationVisible: boolean;
}

export interface Stage3UiAutomationVisibilityInput {
  b1ContentProtectionDisabled: boolean;
  b2ContentProtectionDisabled: boolean;
  focusedSeconds?: number;
}

/**
 * 正式运行始终保护应用窗口。隔离验收只有在显式启用 UI 自动化时才可暂时显示。
 */
export function shouldProtectAppWindow(input: WindowProtectionPolicyInput): boolean {
  return !(
    input.contentProtectionAcceptanceEnabled ||
    (input.stage3AcceptanceEnabled && input.stage3UiAutomationVisible)
  );
}

export function shouldExposeStage3UiAutomation(
  input: Stage3UiAutomationVisibilityInput,
): boolean {
  if (input.b1ContentProtectionDisabled) return true;
  if (!input.b2ContentProtectionDisabled) return false;
  if (input.focusedSeconds === undefined || input.focusedSeconds < 1) return true;
  return (
    (input.focusedSeconds >= 14 * 60 && input.focusedSeconds < 18 * 60) ||
    input.focusedSeconds >= 25 * 60
  );
}
