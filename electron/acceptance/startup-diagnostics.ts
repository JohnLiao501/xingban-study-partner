import type { BrowserWindow } from "electron";

/**
 * 阶段 3 B0：启动稳定性诊断。
 *
 * 只在本机隔离验收环境下启用，用于区分 Electron 主进程失败、renderer
 * `launch-failed`、GPU 子进程缺失依赖和系统驱动故障。正式运行完全不加载。
 *
 * 隐私约束：只输出结构化阶段名、布尔判据、耗时、进程类型与原因码；
 * 不输出窗口标题、学习目标、密钥、图像或 DOM 文本。
 */

export interface StartupProbeView {
  shellReady: boolean;
  dialogReady: boolean;
  bootError: boolean;
  startClicked: boolean;
}

export type StartupDiagnosticsEvent = Record<string, unknown> & { stage: string };

export interface StartupDiagnosticsOutcome {
  shellReady: boolean;
  setupDialogReady: boolean;
  bootError: boolean;
  elapsedMs: number;
  probeFailures: number;
  lastError: string | null;
  pass: boolean;
}

export const STARTUP_SHELL_SELECTOR = ".app-shell";
export const STARTUP_DIALOG_SELECTOR = '[role="dialog"][aria-labelledby="session-setup-title"]';
export const STARTUP_START_BUTTON_SELECTOR = ".button--primary";

export const DEFAULT_STARTUP_PROBE_TIMEOUT_MS = 20_000;
export const DEFAULT_STARTUP_PROBE_INTERVAL_MS = 250;

/**
 * 渲染进程内执行的探针：读取应用外壳与设置弹窗是否已挂载，并在外壳就绪后
 * 点击一次主操作按钮以打开设置弹窗。它模拟用户点击，不提交会话、
 * 不请求屏幕权限、不发起网络请求。
 */
export const STARTUP_PROBE_SCRIPT = `(() => {
  const shell = Boolean(document.querySelector(${JSON.stringify(STARTUP_SHELL_SELECTOR)}));
  const dialog = Boolean(document.querySelector(${JSON.stringify(STARTUP_DIALOG_SELECTOR)}));
  const bootError = Boolean(document.querySelector(".boot-state--error"));
  let startClicked = false;
  if (!dialog && shell) {
    const button = document.querySelector(${JSON.stringify(STARTUP_START_BUTTON_SELECTOR)});
    if (button && !button.disabled) {
      button.click();
      startClicked = true;
    }
  }
  return JSON.stringify({ shell, dialog, bootError, startClicked });
})()`;

const MAX_PROBE_PAYLOAD_LENGTH = 512;

export function parseStartupProbeResult(raw: unknown): StartupProbeView | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_PROBE_PAYLOAD_LENGTH) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const value = parsed as Record<string, unknown>;
  if (typeof value.shell !== "boolean" || typeof value.dialog !== "boolean") return null;
  return {
    shellReady: value.shell,
    dialogReady: value.dialog,
    bootError: value.bootError === true,
    startClicked: value.startClicked === true,
  };
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message.slice(0, 120);
  return typeof error === "string" ? error.slice(0, 120) : "UNKNOWN_PROBE_ERROR";
}

export interface StartupDiagnosticsOptions {
  timeoutMs?: number;
  intervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export class Stage3StartupDiagnostics {
  private readonly timeoutMs: number;
  private readonly intervalMs: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly now: () => number;

  constructor(
    private readonly emit: (event: StartupDiagnosticsEvent) => void,
    private readonly getWindow: () => BrowserWindow | undefined,
    options: StartupDiagnosticsOptions = {},
  ) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_STARTUP_PROBE_TIMEOUT_MS;
    this.intervalMs = options.intervalMs ?? DEFAULT_STARTUP_PROBE_INTERVAL_MS;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = options.now ?? (() => Date.now());
  }

  async run(): Promise<StartupDiagnosticsOutcome> {
    const startedAt = this.now();
    let shellReady = false;
    let setupDialogReady = false;
    let bootError = false;
    let probeFailures = 0;
    let lastError: string | null = null;

    while (this.now() - startedAt < this.timeoutMs) {
      const window = this.getWindow();
      if (!window || window.isDestroyed()) {
        lastError = "MAIN_WINDOW_MISSING";
        break;
      }
      let view: StartupProbeView | null = null;
      try {
        view = parseStartupProbeResult(await window.webContents.executeJavaScript(STARTUP_PROBE_SCRIPT));
      } catch (error) {
        lastError = describeError(error);
      }
      if (!view) {
        probeFailures += 1;
        lastError ??= "PROBE_RESULT_INVALID";
      } else {
        // 启动错误一旦出现即保持，避免后续探针把它覆盖为 false。
        bootError = bootError || view.bootError;
        if (view.shellReady && !shellReady) {
          shellReady = true;
          this.emit({ stage: "shell-ready", elapsedMs: this.now() - startedAt });
        }
        if (view.dialogReady && !setupDialogReady) {
          setupDialogReady = true;
          this.emit({
            stage: "setup-dialog-ready",
            elapsedMs: this.now() - startedAt,
            startClicked: view.startClicked,
          });
          break;
        }
      }
      await this.sleep(this.intervalMs);
    }

    const elapsedMs = this.now() - startedAt;
    const pass = shellReady && setupDialogReady && !bootError;
    const outcome: StartupDiagnosticsOutcome = {
      shellReady,
      setupDialogReady,
      bootError,
      elapsedMs,
      probeFailures,
      lastError,
      pass,
    };
    this.emit({
      stage: pass ? "startup-complete" : "startup-failed",
      ...outcome,
    });
    return outcome;
  }
}

/** 把 `app.getGPUInfo('basic')` 的未知结构收敛为可安全输出的低敏摘要。 */
export function summarizeGpuInfo(raw: unknown): StartupDiagnosticsEvent {
  const event: StartupDiagnosticsEvent = { stage: "gpu-info", available: false };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return event;
  const value = raw as Record<string, unknown>;
  const aux = value.auxAttributes;
  if (aux && typeof aux === "object" && !Array.isArray(aux)) {
    const auxValue = aux as Record<string, unknown>;
    const renderer = typeof auxValue.glRenderer === "string" ? auxValue.glRenderer : null;
    if (renderer) {
      event.glRenderer = renderer.slice(0, 120);
      event.available = true;
    }
  }
  return event;
}
