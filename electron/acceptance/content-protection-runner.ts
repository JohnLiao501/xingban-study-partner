import { BrowserWindow, nativeImage } from "electron";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ElectronCaptureService } from "../capture/capture-service.js";
import { analyzeContentProtectionBitmap, type ContentProtectionColorEvidence } from "./content-protection-analysis.js";

const PROTECTED_MARKER_ID = "xingban-content-protection-acceptance-marker";

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function setProtectedMarker(window: BrowserWindow, visible: boolean): Promise<void> {
  if (window.isDestroyed()) return;
  const script = visible
    ? `(() => {
        document.getElementById(${JSON.stringify(PROTECTED_MARKER_ID)})?.remove();
        const marker = document.createElement("div");
        marker.id = ${JSON.stringify(PROTECTED_MARKER_ID)};
        marker.setAttribute("aria-hidden", "true");
        marker.style.cssText = "position:fixed;right:18px;top:54px;width:320px;height:180px;display:grid;grid-template-columns:1fr 1fr;z-index:2147483647;box-shadow:0 0 0 8px #111;background:#111;pointer-events:none";
        marker.innerHTML = '<div style="background:#ff00ff"></div><div style="background:#00ff00"></div>';
        document.documentElement.appendChild(marker);
      })()`
    : `document.getElementById(${JSON.stringify(PROTECTED_MARKER_ID)})?.remove()`;
  await window.webContents.executeJavaScript(script, true);
}

interface ControlProcess {
  child: ChildProcess;
}

function createControlProcess(mainWindow: BrowserWindow): ControlProcess {
  const mainBounds = mainWindow.getBounds();
  // 对照色最终会经过整屏缩放与 JPEG 60 压缩。窗口过小时，纯色边缘会被
  // 重采样稀释到证据阈值以下；保持较大的成对色块，让“对照可见”本身也成为硬门禁。
  const width = Math.max(360, Math.min(720, mainBounds.width - 96));
  const height = Math.max(220, Math.min(420, mainBounds.height - 160));
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "..",
  );
  const helperPath = path.join(
    projectRoot,
    "resources",
    "bin",
    "windows-foreground-probe.exe",
  );
  if (!existsSync(helperPath)) {
    throw new Error("ACCEPTANCE_CONTROL_HELPER_MISSING");
  }
  const child = spawn(helperPath, [
    "--acceptance-control-window",
    String(mainBounds.x + 40),
    String(mainBounds.y + 90),
    String(width),
    String(height),
  ], {
    shell: false,
    stdio: "ignore",
  });
  return { child };
}

async function waitForControlProcess(control: ControlProcess): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      control.child.removeListener("error", onError);
      control.child.removeListener("exit", onExit);
      if (error) reject(error);
      else resolve();
    };
    const onError = (): void => finish(new Error("ACCEPTANCE_CONTROL_PROCESS_FAILED"));
    const onExit = (): void => finish(new Error("ACCEPTANCE_CONTROL_PROCESS_EXITED"));
    // READY 文本在无控制台的 Electron 父进程下并不可靠。这里仅确认 helper
    // 没有异常退出并给原生窗口留出绘制时间；真正的可见性仍由帧内双色门禁证明。
    const timer = setTimeout(() => finish(), 1_500);
    control.child.once("error", onError);
    control.child.once("exit", onExit);
  });
}

async function stopControlProcess(control: ControlProcess | null): Promise<void> {
  if (!control) return;
  if (control.child.exitCode === null) {
    control.child.kill();
    await Promise.race([
      new Promise<void>((resolve) => control.child.once("exit", () => resolve())),
      delay(3_000),
    ]);
    if (control.child.exitCode === null) {
      control.child.kill("SIGKILL");
    }
  }
}

export class ContentProtectionAcceptanceRunner {
  private hasRun = false;
  private running = false;

  isEnabled(): boolean {
    return process.env.XINGBAN_CONTENT_PROTECTION_ACCEPTANCE === "1";
  }

  async run(
    captureService: ElectronCaptureService,
    mainWindow: BrowserWindow,
    overlayWindow: BrowserWindow,
  ): Promise<ContentProtectionColorEvidence | null> {
    if (!this.isEnabled() || this.hasRun || this.running) return null;
    this.running = true;

    let controlProcess: ControlProcess | null = null;
    let frame: Uint8Array | null = null;
    let bitmap: Buffer | null = null;
    try {
      // 验收启动阶段可能为 UI 自动化暂时关闭保护；在任何取帧动作前强制恢复。
      mainWindow.setContentProtection(true);
      overlayWindow.setContentProtection(true);
      mainWindow.show();
      mainWindow.focus();
      overlayWindow.showInactive();
      await Promise.all([
        setProtectedMarker(mainWindow, true),
        setProtectedMarker(overlayWindow, true),
      ]);

      // Windows Graphics Capture 会排除同一 Electron 可执行程序身份下的受保护窗口；
      // 对照窗使用项目已有的原生 sidecar，才能同时证明“屏幕帧有效”和“本应用窗口被排除”。
      controlProcess = createControlProcess(mainWindow);
      await waitForControlProcess(controlProcess);

      await delay(1_000);
      frame = await captureService.captureFrame();
      if (!frame) throw new Error("ACCEPTANCE_FRAME_UNAVAILABLE");

      const image = nativeImage.createFromBuffer(Buffer.from(frame));
      if (image.isEmpty()) throw new Error("ACCEPTANCE_FRAME_DECODE_FAILED");
      const size = image.getSize();
      bitmap = image.toBitmap({ scaleFactor: 1 });
      const evidence = analyzeContentProtectionBitmap(bitmap, size.width, size.height);
      console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
        ...evidence,
        frameBytes: frame.byteLength,
      })}`);
      this.hasRun = true;
      return evidence;
    } catch (error) {
      const errorCode = error instanceof Error ? error.message : "ACCEPTANCE_UNKNOWN_ERROR";
      console.error(`[Acceptance:ContentProtection] ${JSON.stringify({ outcome: "inconclusive", errorCode })}`);
      this.hasRun = true;
      return null;
    } finally {
      frame?.fill(0);
      bitmap?.fill(0);
      await stopControlProcess(controlProcess);
      await Promise.allSettled([
        setProtectedMarker(mainWindow, false),
        setProtectedMarker(overlayWindow, false),
        captureService.stopCapture(),
      ]);
      if (!overlayWindow.isDestroyed()) overlayWindow.hide();
      this.running = false;
    }
  }
}
