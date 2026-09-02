import {
  app,
  BrowserWindow,
  desktopCapturer,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  net,
  protocol,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..", "..");
const cjsPreload = path.join(currentDirectory, "preload.cjs");
const preloadPath = fs.existsSync(cjsPreload) ? cjsPreload : path.join(currentDirectory, "preload.js");
const rendererPath = path.join(projectRoot, "dist-renderer", "index.html");
const schemaPath = path.join(projectRoot, "schemas", "partner-pack.v1.schema.json");

import {
  REACTION_KEYS,
  type BootstrapData,
  type InstalledPartnerSummary,
  type OverlayPreviewPayload,
  type PartnerPackManifestV1,
  type ReactionKey,
} from "../shared/partner-pack.js";
import {
  DEFAULT_PRIVATE_COMMUNICATION_POLICY,
  type ObservationLabel,
  type SessionFinishMode,
  type StartSessionInput,
} from "../shared/session.js";
import type { SaveAppRuleInput } from "../shared/rules.js";
import {
  discoverLocalPacks,
  installPackDirectory,
  loadBundledDemo,
  loadPackFromDirectory,
} from "./partner-pack/service.js";
import { isSafePackPath } from "./partner-pack/validator.js";
import { SessionService } from "./session/service.js";
import { XingbanDatabase } from "./storage/database.js";
import { PermissionManager } from "./security/permission-manager.js";
import { SecretStore } from "./security/secret-store.js";
import { ElectronCaptureService } from "./capture/capture-service.js";
import { ContentProtectionAcceptanceRunner } from "./acceptance/content-protection-runner.js";
import { runSafeStorageAcceptance } from "./acceptance/safe-storage-runner.js";
import {
  loadStage3AcceptanceRuntimeConfig,
  normalizeStage3AcceptanceSnapshot,
  STAGE3_ACCEPTANCE_RULE_IDS,
  validateStage3AcceptanceStart,
} from "./acceptance/stage3-environment.js";
import { Stage3AcceptanceRecorder } from "./acceptance/stage3-recorder.js";
import {
  Stage3StartupDiagnostics,
  summarizeGpuInfo,
  type StartupDiagnosticsEvent,
} from "./acceptance/startup-diagnostics.js";
import {
  shouldExposeStage3UiAutomation,
  shouldProtectAppWindow,
} from "./acceptance/window-protection-policy.js";
import { OpenAiVisionAdapter } from "./vision/openai-vision-adapter.js";
import { WindowsForegroundProbe } from "./inspection/windows-foreground-probe.js";
import { LocalRuleClassifier } from "./inspection/local-rule-classifier.js";
import { InspectionEngine } from "./inspection/inspection-engine.js";
import { mapInspectionToObservationParams } from "./inspection/observation.js";
import { OverlayVisibilityTimeout } from "./window/overlay-visibility.js";
import type { SaveVisionSettingsInput, VisionSettingsView } from "../shared/inspection.js";
import {
  validateSaveAppRuleInput,
  validateSaveVisionSettingsInput,
  validateStartSessionInput,
} from "../shared/validation.js";

const stage3Acceptance = loadStage3AcceptanceRuntimeConfig();
const stage3B1Rehearsal = Boolean(
  stage3Acceptance && process.env.XINGBAN_STAGE3_B1_REHEARSAL === "1",
);
const stage3B1ContentProtectionDisabled = Boolean(
  stage3B1Rehearsal && process.env.XINGBAN_STAGE3_B1_DISABLE_CONTENT_PROTECTION === "1",
);
const stage3B2ContentProtectionDisabled = Boolean(
  stage3Acceptance &&
  !stage3B1Rehearsal &&
  process.env.XINGBAN_STAGE3_B2_DISABLE_CONTENT_PROTECTION === "1",
);
if (stage3Acceptance) {
  app.setPath("userData", stage3Acceptance.userDataPath);
  app.commandLine.appendSwitch("disable-http-cache");
}
const stage3AcceptanceRecorder = stage3Acceptance
  ? new Stage3AcceptanceRecorder((event) => {
      console.log(`[Acceptance:Stage3] ${JSON.stringify(event)}`);
    }, stage3Acceptance.plan)
  : null;

// B0 启动诊断：只在隔离验收环境输出结构化进程事件，用于区分主进程失败、
// renderer launch-failed 与 GPU 子进程故障。正式运行不注册任何额外输出。
function emitStartupDiagnostics(event: StartupDiagnosticsEvent): void {
  console.log(`[Acceptance:Startup] ${JSON.stringify(event)}`);
}

if (stage3Acceptance) {
  app.on("child-process-gone", (_event, details) => {
    emitStartupDiagnostics({
      stage: "child-process-gone",
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      serviceName:
        typeof details.serviceName === "string" ? details.serviceName.slice(0, 64) : null,
    });
  });
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: "partner-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
    },
  },
]);




const permissionManager = new PermissionManager();
let captureService: ElectronCaptureService | null = null;
const contentProtectionAcceptance = new ContentProtectionAcceptanceRunner();
let secretStore: SecretStore | null = null;
let visionAdapter: OpenAiVisionAdapter | null = null;
let foregroundProbe: WindowsForegroundProbe | null = null;
let inspectionEngine: InspectionEngine | null = null;
let appWindowsProtected = true;

const SETTINGS_KEY_VISION = "vision_settings";
const DEFAULT_VISION_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  sendWindowTitle: false,
  visionEnabled: false,
  timeoutMs: 10000,
} as const;

type VisionRuntimeConfig = Omit<VisionSettingsView, "apiKeyConfigured">;

let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let captureWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let quitAfterShutdown = false;
let shutdownPromise: Promise<{ captureStopped: boolean; probeStopped: boolean }> | null = null;
let sessionService: SessionService | undefined;
let database: XingbanDatabase | undefined;
let bundledDemo: Awaited<ReturnType<typeof loadBundledDemo>> | undefined;
let activePartnerManifest: PartnerPackManifestV1 | undefined;
const partnerDirectoryMap = new Map<string, string>();
const overlayVisibility = new OverlayVisibilityTimeout(() => overlayWindow?.hide());

function getPartnerDirectory(partnerId: string): string | null {
  if (partnerDirectoryMap.has(partnerId)) {
    return partnerDirectoryMap.get(partnerId)!;
  }
  if (bundledDemo && bundledDemo.partnerId === partnerId) {
    return path.join(projectRoot, "examples", "demo-partner");
  }
  const installed = database?.listInstalledPacks() ?? [];
  const found = installed.find((p) => p.partnerId === partnerId);
  if (found) {
    return found.installPath;
  }
  return null;
}


function createTrayIcon(): Electron.NativeImage {
  const iconPath = path.join(projectRoot, "resources", "icons", "tray.png");
  if (fs.existsSync(iconPath)) {
    return nativeImage.createFromPath(iconPath);
  }
  const base64Png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAAGcSURBVFhH1ZcxS8RAEIWvtPQnWFr6E/wJlpaWlnbJCnLaaCnYXGGRwsLCwka4S1YJdhYWNiIih72Fgggi4oxM9uIlb43ecbcjfvCa7CTvZXezu2m1/jvtnGfwmirG8iZeUyXO6Kmd8yxeVyGyvGgss0lpGdtUkO4vAlhKsE0Fk1E+CHCPbcGRcXfmA/V4HmuCYnq8VA0QZ7SGNUExljq1AJaOsSYoMu7QA69qi1LU5bna+A8knyXWTh2ZfHFGO2juRJ0gi5I8NEp5RcbZN/UldVI/UZhRTfcvnTbO/Laxw4xqKhLD/iN/8fDCvJX7dSOFcZOKErzhJx1cDc1LTm79umZRIr61IG5xoUR2OP+Guo6u0Z65d+fXVeWeS4n41Iy/47cw2+fMz29D8/cP5r0Lv24s0yaawkiI075T1Xwqpk0UYTLq4psWkt0xhCmynvKCZy7SMC/B4RB5n1dIYkuH2P1YExRZUKAHdE/HuCOq7IRIbOlGzGU+YJsKxtJuEUD7NFRSngvjjFaxTQU5gslRzNtUNPmzn5KSSd/+E8NPF71V73PoAAAAAElFTkSuQmCC";
  return nativeImage.createFromDataURL(base64Png);
}


function hardenWindow(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (url !== currentUrl) event.preventDefault();
  });
}

function resolveAppWindowProtection(focusedSeconds?: number): boolean {
  return shouldProtectAppWindow({
    contentProtectionAcceptanceEnabled: contentProtectionAcceptance.isEnabled(),
    stage3AcceptanceEnabled: Boolean(stage3Acceptance),
    stage3UiAutomationVisible: shouldExposeStage3UiAutomation({
      b1ContentProtectionDisabled: stage3B1ContentProtectionDisabled,
      b2ContentProtectionDisabled: stage3B2ContentProtectionDisabled,
      focusedSeconds,
    }),
  });
}

function updateAppWindowProtection(focusedSeconds: number): void {
  const protect = resolveAppWindowProtection(focusedSeconds);
  if (protect === appWindowsProtected) return;
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.setContentProtection(protect);
  if (overlayWindow && !overlayWindow.isDestroyed()) overlayWindow.setContentProtection(protect);
  appWindowsProtected = protect;
}

async function loadRenderer(window: BrowserWindow, view?: "overlay" | "capture"): Promise<void> {
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (view) url.searchParams.set("view", view);
    await window.loadURL(url.toString());
    return;
  }
  // Electron 44 的 `loadFile()` 不会对非 ASCII 路径做百分号编码；工作区位于含中文的
  // 目录时全部窗口都会以 ERR_FAILED (-2) 失败（表现为莫名的 renderer/GPU 启动失败）。
  // 改用 `pathToFileURL()` 生成正确编码的 file:// URL 后加载，行为与 ASCII 路径一致。
  const fileUrl = pathToFileURL(rendererPath);
  if (view) fileUrl.searchParams.set("view", view);
  await window.loadURL(fileUrl.href);
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: "#07111f",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ["--xingban-view=main"],
    },
  });
  // 隔离验收只在需要 UI 自动化的时段暂时显示；截图工作窗始终保护。
  appWindowsProtected = resolveAppWindowProtection();
  window.setContentProtection(appWindowsProtected);
  hardenWindow(window);
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("[MainWindow] Failed to load renderer:", errorCode, errorDescription);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[RenderProcessGone]", details);
  });
  window.once("ready-to-show", () => {
    window.show();
    window.focus();
  });


  window.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      window.hide();
    }
  });
  void loadRenderer(window);
  return window;
}

function createOverlayWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 420,
    height: 236,
    minWidth: 360,
    minHeight: 203,
    show: false,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: true,
    backgroundColor: "#07111f",
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: ["--xingban-view=overlay"],
    },
  });
  window.setAlwaysOnTop(true, "floating");
  appWindowsProtected = resolveAppWindowProtection();
  window.setContentProtection(appWindowsProtected);
  window.setIgnoreMouseEvents(true, { forward: true });
  hardenWindow(window);
  void loadRenderer(window, "overlay");
  return window;
}

function createCaptureWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      additionalArguments: ["--xingban-view=capture"],
    },
  });
  window.setContentProtection(true);
  permissionManager.setCaptureWebContentsId(window.webContents.id);
  window.webContents.on("did-start-loading", () => {
    captureService?.handleRendererUnavailable();
  });
  window.webContents.on("render-process-gone", () => {
    if (contentProtectionAcceptance.isEnabled()) {
      console.error('[Acceptance:ContentProtection] {"outcome":"capture-renderer-gone"}');
    }
    captureService?.handleRendererUnavailable();
  });
  window.webContents.on("console-message", (details) => {
    if (!contentProtectionAcceptance.isEnabled()) return;
    const match = /^\[CaptureView\] ([A-Za-z0-9_-]{1,64})$/.exec(details.message);
    console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
      outcome: "capture-renderer",
      code: match?.[1] ?? "RENDERER_CONSOLE_REDACTED",
    })}`);
  });
  window.webContents.once("destroyed", () => {
    if (contentProtectionAcceptance.isEnabled()) {
      console.error('[Acceptance:ContentProtection] {"outcome":"capture-window-destroyed"}');
    }
    permissionManager.setCaptureWebContentsId(null);
    captureService?.handleRendererUnavailable();
    inspectionEngine?.cancelPendingConfirmation(true);
    void captureService?.stopCapture();
  });
  hardenWindow(window);
  void loadRenderer(window, "capture");
  return window;
}

function createTray(): Tray {
  const appTray = new Tray(createTrayIcon());
  appTray.setToolTip("星伴 - AI 伴学");
  appTray.on("click", () => {
    if (mainWindow) {
      if (mainWindow.isVisible()) {
        if (mainWindow.isFocused()) {
          mainWindow.hide();
        } else {
          mainWindow.focus();
        }
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    }
  });
  appTray.setContextMenu(Menu.buildFromTemplate([

    {
      label: "打开督学室",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: "隐藏巡查窗",
      click: () => overlayVisibility.hideNow(),
    },
    {
      label: "停止屏幕巡查",
      click: () => {
        inspectionEngine?.cancelPendingConfirmation(true);
        void captureService?.stopCapture();
      },
    },
    { type: "separator" },
    {
      label: "退出星伴",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]));
  appTray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
  return appTray;
}

function requireSender(
  event: IpcMainInvokeEvent,
  expectedWindow: BrowserWindow | undefined,
): BrowserWindow {
  if (!expectedWindow || expectedWindow.isDestroyed() || event.sender !== expectedWindow.webContents) {
    throw new Error("IPC_UNAUTHORIZED_SENDER");
  }
  return expectedWindow;
}

function requireMainSender(event: IpcMainInvokeEvent): BrowserWindow {
  return requireSender(event, mainWindow);
}

function requireCaptureSender(event: IpcMainInvokeEvent): BrowserWindow {
  return requireSender(event, captureWindow);
}

function isOverlayPayload(value: unknown): value is OverlayPreviewPayload {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const keys = Object.keys(value);
  const expectedKeys = ["reactionKey", "label", "line", "videoPath", "loop"];
  if (keys.length !== expectedKeys.length || !keys.every((key) => expectedKeys.includes(key))) {
    return false;
  }
  const payload = value as Partial<OverlayPreviewPayload>;
  return typeof payload.reactionKey === "string" &&
    REACTION_KEYS.includes(payload.reactionKey as ReactionKey) &&
    typeof payload.label === "string" && payload.label.length <= 100 &&
    typeof payload.line === "string" && payload.line.length <= 1000 &&
    typeof payload.videoPath === "string" && payload.videoPath.length <= 500 &&
    typeof payload.loop === "boolean";
}

function requireSessionId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new Error("IPC_INVALID_PAYLOAD");
  }
  return value;
}

function loadVisionConfig(): VisionRuntimeConfig {
  if (stage3Acceptance) {
    return {
      baseUrl: stage3Acceptance.mockBaseUrl,
      model: "stage3-local-mock",
      sendWindowTitle: false,
      visionEnabled: true,
      timeoutMs: 10000,
    };
  }
  const raw = database?.getAppSetting(SETTINGS_KEY_VISION);
  if (!raw) return { ...DEFAULT_VISION_CONFIG };
  try {
    const validated = validateSaveVisionSettingsInput(JSON.parse(raw));
    return {
      baseUrl: validated.baseUrl,
      model: validated.model,
      sendWindowTitle: validated.sendWindowTitle,
      visionEnabled: validated.visionEnabled,
      timeoutMs: validated.timeoutMs,
    };
  } catch {
    return { ...DEFAULT_VISION_CONFIG };
  }
}

function registerIpc(): void {
  ipcMain.handle("app:get-bootstrap", async (event): Promise<BootstrapData> => {
    requireMainSender(event);
    const currentManifest = activePartnerManifest ?? bundledDemo ?? await loadBundledDemo(projectRoot);
    return {
      manifest: currentManifest,
      assetBaseUrl: `partner-asset://${currentManifest.partnerId}/`,
      desktopRuntime: true,
      acceptancePlan: stage3Acceptance?.plan,
    };
  });

  ipcMain.handle("partner:list", async (event): Promise<InstalledPartnerSummary[]> => {
    requireMainSender(event);
    const result: InstalledPartnerSummary[] = [];
    const activeId = activePartnerManifest?.partnerId ?? bundledDemo?.partnerId;

    if (bundledDemo) {
      result.push({
        partnerId: bundledDemo.partnerId,
        packVersion: bundledDemo.packVersion,
        displayName: bundledDemo.displayName,
        description: bundledDemo.description,
        sourceType: bundledDemo.sourceType,
        distribution: bundledDemo.distribution,
        active: bundledDemo.partnerId === activeId,
      });
    }

    const installed = database?.listInstalledPacks() ?? [];
    for (const pack of installed) {
      if (!result.some((r) => r.partnerId === pack.partnerId)) {
        result.push({
          partnerId: pack.partnerId,
          packVersion: pack.packVersion,
          displayName: pack.displayName,
          description: "",
          sourceType: pack.sourceType as InstalledPartnerSummary["sourceType"],
          distribution: pack.distribution as InstalledPartnerSummary["distribution"],
          active: pack.partnerId === activeId,
        });
      }
    }

    return result;
  });

  ipcMain.handle("partner:select", async (event, partnerId: unknown): Promise<BootstrapData> => {
    requireMainSender(event);
    if (typeof partnerId !== "string" || partnerId.length < 1 || partnerId.length > 120) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    if (stage3Acceptance && partnerId !== bundledDemo?.partnerId) {
      throw new Error("ACCEPTANCE_CONFIGURATION_LOCKED");
    }

    const dir = getPartnerDirectory(partnerId);
    if (!dir) {
      throw new Error("PARTNER_NOT_FOUND");
    }

    const manifest = (bundledDemo && bundledDemo.partnerId === partnerId)
      ? bundledDemo
      : await loadPackFromDirectory(dir, schemaPath);

    activePartnerManifest = manifest;
    partnerDirectoryMap.set(partnerId, dir);
    database?.setActivePartnerId(partnerId);

    return {
      manifest,
      assetBaseUrl: `partner-asset://${manifest.partnerId}/`,
      desktopRuntime: true,
      acceptancePlan: stage3Acceptance?.plan,
    };
  });

  ipcMain.handle("partner:import-directory", async (event) => {
    requireMainSender(event);
    if (stage3Acceptance) throw new Error("ACCEPTANCE_CONFIGURATION_LOCKED");
    const options: Electron.OpenDialogOptions = {
      title: "选择督学伙伴包目录",
      properties: ["openDirectory"],
    };
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) {
      return { ok: false, errors: [], cancelled: true };
    }

    const installRoot = path.join(app.getPath("userData"), "partners");
    const installResult = await installPackDirectory(result.filePaths[0], installRoot, schemaPath);

    if (installResult.ok && installResult.manifest && installResult.installedPath) {
      partnerDirectoryMap.set(installResult.manifest.partnerId, installResult.installedPath);
      database?.saveInstalledPack({
        partnerId: installResult.manifest.partnerId,
        packVersion: installResult.manifest.packVersion,
        displayName: installResult.manifest.displayName,
        sourceType: installResult.manifest.sourceType,
        distribution: installResult.manifest.distribution,
        installPath: installResult.installedPath,
        manifestHash: "",
        enabled: true,
        installedAt: new Date().toISOString(),
      });
    }

    return installResult;
  });


  ipcMain.handle("overlay:show-preview", async (event, payload: unknown) => {
    requireMainSender(event);
    if (!isOverlayPayload(payload)) throw new Error("IPC_INVALID_PAYLOAD");
    if (!overlayWindow || overlayWindow.isDestroyed()) overlayWindow = createOverlayWindow();
    const send = () => overlayWindow?.webContents.send("overlay:preview", payload);
    if (overlayWindow.webContents.isLoading()) {
      overlayWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }
    overlayWindow.showInactive();
    overlayVisibility.schedule();
  });
  ipcMain.handle("overlay:hide", (event) => {
    requireMainSender(event);
    overlayVisibility.hideNow();
  });
  ipcMain.handle("session:get-active", (event) => {
    requireMainSender(event);
    return sessionService?.getActive() ?? null;
  });
  ipcMain.handle("session:start", async (event, rawInput: unknown) => {
    requireMainSender(event);
    const input = validateStartSessionInput(rawInput);
    if (stage3Acceptance) validateStage3AcceptanceStart(input);

    // 会话真相先由主进程建立；捕获或探针失败只降级巡查，不回滚学习会话。
    const snapshot = sessionService?.start(input);
    if (!snapshot) return null;

    inspectionEngine?.dispose();
    inspectionEngine = null;

    // 只向巡查引擎注入本场选择且当前仍启用的规则。
    const allRules = database?.listAppRules() ?? [];
    const activeRules = allRules.filter((r) => {
      if (!r.enabled) return false;
      if (r.decision === "allow" && input.allowRuleIds) return input.allowRuleIds.includes(r.id);
      if (r.decision === "block" && input.blockRuleIds) return input.blockRuleIds.includes(r.id);
      return true;
    });

    const resolveActivePatrol = (sessionId: string, label: ObservationLabel): void => {
      const active = sessionService?.getActive();
      if (active?.sessionId === sessionId && active.phase === "patrolling") {
        sessionService?.applyInspectionResult(sessionId, label);
      }
    };

    if (foregroundProbe && captureService && visionAdapter) {
      inspectionEngine = new InspectionEngine({
        sessionId: snapshot.sessionId,
        goal: snapshot.goal,
        visionEnabled: Boolean(input.visionEnabled),
        sendWindowTitle: Boolean(input.sendWindowTitle),
        privateCommunicationPolicy: input.privateCommunicationPolicy
          ?? DEFAULT_PRIVATE_COMMUNICATION_POLICY,
        rules: activeRules,
        probe: foregroundProbe,
        classifier: new LocalRuleClassifier(),
        captureService,
        visionAdapter,
        onConfirmDeviation: (id) => resolveActivePatrol(id, "distracted"),
        onResolvePending: (id, label) => resolveActivePatrol(id, label),
        onLocalClassification: (sample, result) => {
          stage3AcceptanceRecorder?.recordLocalClassification(
            sample?.processName ?? null,
            result,
          );
        },
        onObservation: (result, confirmed) => {
          if (database) {
            database.recordStructuredObservation(
              mapInspectionToObservationParams(snapshot.sessionId, result, confirmed),
            );
          }
          stage3AcceptanceRecorder?.recordObservation(result, confirmed);
          const active = sessionService?.getActive();
          if (stage3B1Rehearsal && active && active.patrolCount >= 2) {
            // B1 只跑前两个节点。事件先同步写入 stdout，再从主进程正常退出，
            // 让 before-quit 完成捕获流、探针、数据库与托盘的关停回执。
            setImmediate(() => app.quit());
          }
        },
      });
    }

    if (input.captureSourceId && captureService) {
      await captureService.startCapture(input.captureSourceId);
    }

    return snapshot;
  });
  ipcMain.handle("session:pause", (event, sessionId: unknown) => {
    requireMainSender(event);
    const snapshot = sessionService?.pause(requireSessionId(sessionId));
    inspectionEngine?.cancelPendingConfirmation();
    return snapshot;
  });
  ipcMain.handle("session:resume", (event, sessionId: unknown) => {
    requireMainSender(event);
    return sessionService?.resume(requireSessionId(sessionId));
  });
  ipcMain.handle("session:complete-feedback", (event, sessionId: unknown) => {
    requireMainSender(event);
    return sessionService?.completeFeedback(requireSessionId(sessionId));
  });
  ipcMain.handle("session:start-break", (event, sessionId: unknown) => {
    requireMainSender(event);
    return sessionService?.startBreak(requireSessionId(sessionId));
  });
  ipcMain.handle("session:finish", async (event, sessionId: unknown, mode: unknown) => {
    requireMainSender(event);
    if (mode !== "completed" && mode !== "aborted" && mode !== "interrupted") {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    const snapshot = sessionService?.finish(
      requireSessionId(sessionId),
      mode as SessionFinishMode,
    );
    inspectionEngine?.dispose();
    inspectionEngine = null;
    await captureService?.stopCapture();
    return snapshot;
  });
  ipcMain.handle("history:list", (event, limit: unknown) => {
    requireMainSender(event);
    if (limit !== undefined && (
      typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 200
    )) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return database?.listSessionHistory(limit ?? 50) ?? [];
  });
  ipcMain.handle("history:list-observations", (event, sessionId: unknown) => {
    requireMainSender(event);
    return database?.listSessionObservations(requireSessionId(sessionId)) ?? [];
  });
  ipcMain.handle("partner:get-progress", (event, partnerId: unknown) => {
    requireMainSender(event);
    if (typeof partnerId !== "string" || partnerId.length < 1 || partnerId.length > 120) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return database?.getPartnerProgress(partnerId) ?? {
      partnerId,
      totalTrust: 0,
      currentLevelId: "initial",
      lastSessionAt: null,
    };
  });
  ipcMain.handle("rules:list", (event) => {
    requireMainSender(event);
    return database?.listAppRules() ?? [];
  });
  ipcMain.handle("rules:save", (event, rawInput: unknown) => {
    requireMainSender(event);
    if (stage3Acceptance) throw new Error("ACCEPTANCE_CONFIGURATION_LOCKED");
    const input: SaveAppRuleInput = validateSaveAppRuleInput(rawInput);
    return database?.saveAppRule(input);
  });
  ipcMain.handle("rules:delete", (event, id: unknown) => {
    requireMainSender(event);
    if (stage3Acceptance) throw new Error("ACCEPTANCE_CONFIGURATION_LOCKED");
    if (typeof id !== "string" || id.length < 1 || id.length > 100) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    database?.deleteAppRule(id);
  });
  ipcMain.handle("capture:list-sources", async (event) => {
    requireMainSender(event);
    return captureService ? await captureService.listSources() : [];
  });
  ipcMain.handle("capture:get-status", (event) => {
    requireMainSender(event);
    return captureService?.getStatus() ?? "inactive";
  });
  ipcMain.handle("capture:start", async (event, sourceId: unknown) => {
    requireMainSender(event);
    const active = sessionService?.getActive();
    if (!active || ["completed", "aborted", "interrupted"].includes(active.phase)) {
      throw new Error("CAPTURE_SESSION_INACTIVE");
    }
    if (typeof sourceId !== "string" || sourceId.length < 1 || sourceId.length > 200) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    if (!captureService) throw new Error("CAPTURE_UNAVAILABLE");
    inspectionEngine?.cancelPendingConfirmation(true);
    await captureService.startCapture(sourceId);
    return captureService.getStatus();
  });
  ipcMain.handle("capture:stop", async (event) => {
    requireMainSender(event);
    inspectionEngine?.cancelPendingConfirmation(true);
    await captureService?.stopCapture();
  });
  ipcMain.handle("capture:send-frame", (event, frameData: unknown) => {
    requireCaptureSender(event);
    if (!(frameData instanceof Uint8Array) && frameData !== null) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    captureService?.handleIncomingFrame(frameData);
  });
  ipcMain.handle("capture:renderer-ready", (event) => {
    requireCaptureSender(event);
    if (contentProtectionAcceptance.isEnabled()) {
      console.log('[Acceptance:ContentProtection] {"outcome":"renderer-ready-ipc"}');
    }
    captureService?.handleRendererReady();
  });
  ipcMain.handle("capture:stream-ready", (event) => {
    requireCaptureSender(event);
    if (contentProtectionAcceptance.isEnabled()) {
      console.log('[Acceptance:ContentProtection] {"outcome":"stream-ready-ipc"}');
    }
    captureService?.handleStreamReady();
  });
  ipcMain.handle("capture:stream-ended", (event) => {
    requireCaptureSender(event);
    if (contentProtectionAcceptance.isEnabled()) {
      console.error('[Acceptance:ContentProtection] {"outcome":"stream-ended-ipc"}');
    }
    inspectionEngine?.cancelPendingConfirmation(true);
    captureService?.handleStreamEnded();
  });
  ipcMain.handle("capture:stream-stopped", (event) => {
    requireCaptureSender(event);
    captureService?.handleStreamStopped();
  });
  ipcMain.handle("settings:get-vision", (event): VisionSettingsView => {
    requireMainSender(event);
    const savedConfig = loadVisionConfig();
    return {
      baseUrl: savedConfig.baseUrl,
      model: savedConfig.model,
      apiKeyConfigured: stage3Acceptance ? true : (secretStore?.hasApiKey() ?? false),
      sendWindowTitle: savedConfig.sendWindowTitle,
      visionEnabled: savedConfig.visionEnabled,
      timeoutMs: savedConfig.timeoutMs,
    };
  });
  ipcMain.handle("settings:save-vision", (event, rawInput: unknown): VisionSettingsView => {
    requireMainSender(event);
    if (!database || !secretStore) throw new Error("DB_NOT_INITIALIZED");
    const input: SaveVisionSettingsInput = validateSaveVisionSettingsInput(rawInput);

    if (stage3Acceptance) {
      return {
        baseUrl: stage3Acceptance.mockBaseUrl,
        model: "stage3-local-mock",
        apiKeyConfigured: true,
        sendWindowTitle: false,
        visionEnabled: true,
        timeoutMs: 10000,
      };
    }

    if (input.clearApiKey) {
      secretStore.clearApiKey();
    } else if (input.apiKey && input.apiKey.trim()) {
      secretStore.setApiKey(input.apiKey);
    }

    const configToSave = {
      baseUrl: input.baseUrl,
      model: input.model,
      sendWindowTitle: input.sendWindowTitle,
      visionEnabled: input.visionEnabled,
      timeoutMs: input.timeoutMs,
    };

    database.setAppSetting(SETTINGS_KEY_VISION, JSON.stringify(configToSave));
    visionAdapter?.updateConfig({
      baseUrl: configToSave.baseUrl,
      model: configToSave.model,
      timeoutMs: configToSave.timeoutMs,
    });

    return {
      ...configToSave,
      apiKeyConfigured: secretStore.hasApiKey(),
    };
  });
  ipcMain.handle("settings:test-connection", async (event) => {
    requireMainSender(event);
    if (!visionAdapter) return { ok: false, message: "适配器未初始化" };
    return await visionAdapter.testConnection();
  });
  ipcMain.handle("window:minimize", (event) => requireMainSender(event).minimize());
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = requireMainSender(event);
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle("window:close", (event) => requireMainSender(event).close());
}

const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.setAppUserModelId("com.xingban.study-partner");

  app.whenReady().then(async () => {

  session.defaultSession.setPermissionCheckHandler((webContents, permission, _origin, details) => {
    if (!webContents) return false;
    const allowed = permissionManager.shouldAllowPermissionCheck(
      webContents.id,
      permission,
      details as { mediaType?: string; isMainFrame?: boolean },
    );
    if (contentProtectionAcceptance.isEnabled()) {
      console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
        outcome: "permission-check",
        permission,
        mediaType: details.mediaType ?? null,
        isMainFrame: details.isMainFrame,
        allowed,
      })}`);
    }
    return allowed;
  });
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permissionManager.shouldAllowPermissionRequest(
      webContents.id,
      permission,
      details as { mediaTypes?: string[] },
    );
    if (contentProtectionAcceptance.isEnabled()) {
      console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
        outcome: "permission-request",
        permission,
        mediaTypes: "mediaTypes" in details ? details.mediaTypes ?? [] : [],
        allowed,
      })}`);
    }
    callback(allowed);
  });
  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    const currentCaptureWindow = captureWindow;
    const frame = request.frame;
    const captureWindowExists = Boolean(
      currentCaptureWindow && !currentCaptureWindow.isDestroyed(),
    );
    const frameMatches = Boolean(
      currentCaptureWindow && frame &&
      frame === currentCaptureWindow.webContents.mainFrame,
    );
    const trustedFrameUrl = Boolean(
      currentCaptureWindow && frame &&
      frame.url === currentCaptureWindow.webContents.getURL(),
    );
    const validRequester = Boolean(
      captureWindowExists &&
      frameMatches &&
      trustedFrameUrl &&
      request.videoRequested &&
      !request.audioRequested,
    );
    if (contentProtectionAcceptance.isEnabled()) {
      console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
        outcome: "display-request",
        captureWindowExists,
        frameMatches,
        trustedFrameUrl,
        validRequester,
        videoRequested: request.videoRequested,
        audioRequested: request.audioRequested,
      })}`);
    }
    if (!validRequester || !currentCaptureWindow) {
      try {
        callback({});
      } catch {
        // Electron 44/Windows 在拒绝 video 请求时可能同步抛 TypeError；拒绝仍生效。
      }
      return;
    }

    const auth = permissionManager.consumeCaptureAuth(currentCaptureWindow.webContents.id);
    if (!auth) {
      callback({});
      return;
    }

    void desktopCapturer.getSources({
      types: ["screen"],
      thumbnailSize: { width: 0, height: 0 },
      fetchWindowIcons: false,
    }).then((sources) => {
      const selected = sources.find((source) => source.id === auth.sourceId);
      const requestStillActive = captureService?.isAwaitingStream(auth.sourceId) ?? false;
      if (contentProtectionAcceptance.isEnabled()) {
        console.log(`[Acceptance:ContentProtection] ${JSON.stringify({
          outcome: "source-resolution",
          sourceCount: sources.length,
          selectedFound: Boolean(selected),
          requestStillActive,
        })}`);
      }
      try {
        callback(selected && requestStillActive ? { video: selected } : {});
      } catch {
        // 只允许失败关闭；不得在回调异常后改授其他源或重试。
      }
    }).catch(() => {
      try {
        callback({});
      } catch {
        // 安全拒绝。
      }
    });
  }, { useSystemPicker: false });
  bundledDemo = await loadBundledDemo(projectRoot);
  database = new XingbanDatabase(path.join(app.getPath("userData"), "xingban.sqlite3"));
  secretStore = new SecretStore(database);
  void runSafeStorageAcceptance(app.getPath("temp"));
  if (stage3Acceptance) {
    database.saveAppRule({
      id: STAGE3_ACCEPTANCE_RULE_IDS.allow,
      matchType: "process",
      pattern: stage3Acceptance.plan.allowProcessName,
      decision: "allow",
      enabled: true,
    });
    database.saveAppRule({
      id: STAGE3_ACCEPTANCE_RULE_IDS.block,
      matchType: "process",
      pattern: stage3Acceptance.plan.blockProcessName,
      decision: "block",
      enabled: true,
    });
  }

  protocol.handle("partner-asset", (request) => {
    try {
      const parsedUrl = new URL(request.url);
      const partnerId = decodeURIComponent(parsedUrl.hostname);
      let relativePath = decodeURIComponent(parsedUrl.pathname);
      if (relativePath.startsWith("/")) {
        relativePath = relativePath.slice(1);
      }

      const packRoot = getPartnerDirectory(partnerId);
      if (!packRoot) {
        return new Response("Partner Not Found", { status: 404 });
      }

      if (!isSafePackPath(relativePath)) {
        return new Response("Forbidden Path", { status: 403 });
      }

      const resolvedRoot = path.resolve(packRoot);
      const resolvedPath = path.resolve(packRoot, ...relativePath.split("/"));
      if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
        return new Response("Forbidden Path", { status: 403 });
      }

      return net.fetch(pathToFileURL(resolvedPath).toString());
    } catch {
      return new Response("Asset Load Error", { status: 500 });
    }
  });

  const demoPath = path.join(projectRoot, "examples", "demo-partner");
  if (bundledDemo) {
    partnerDirectoryMap.set(bundledDemo.partnerId, demoPath);
  }

  // 发现本地 private-packs 中的伙伴包并注册到数据库
  const privatePacksDir = path.join(projectRoot, "private-packs");
  const discovered = await discoverLocalPacks(privatePacksDir, schemaPath);
  for (const pack of discovered) {
    partnerDirectoryMap.set(pack.manifest.partnerId, pack.directoryPath);
    database.saveInstalledPack({
      partnerId: pack.manifest.partnerId,
      packVersion: pack.manifest.packVersion,
      displayName: pack.manifest.displayName,
      sourceType: pack.manifest.sourceType,
      distribution: pack.manifest.distribution,
      installPath: pack.directoryPath,
      manifestHash: "",
      enabled: true,
      installedAt: new Date().toISOString(),
    });
  }

  // 载入已安装伙伴
  const installedPacks = database.listInstalledPacks();
  for (const pack of installedPacks) {
    if (!partnerDirectoryMap.has(pack.partnerId)) {
      partnerDirectoryMap.set(pack.partnerId, pack.installPath);
    }
  }

  // 恢复活跃伙伴
  const savedActiveId = database.getActivePartnerId();
  if (savedActiveId && savedActiveId !== bundledDemo?.partnerId) {
    const packDir = getPartnerDirectory(savedActiveId);
    if (packDir) {
      try {
        activePartnerManifest = await loadPackFromDirectory(packDir, schemaPath);
      } catch {
        activePartnerManifest = bundledDemo;
      }
    } else {
      activePartnerManifest = bundledDemo;
    }
  } else {
    activePartnerManifest = bundledDemo;
  }

  const initialVision = loadVisionConfig();

  visionAdapter = new OpenAiVisionAdapter({
    baseUrl: initialVision.baseUrl,
    model: initialVision.model,
    timeoutMs: initialVision.timeoutMs,
    getApiKey: () => stage3Acceptance?.mockApiToken ?? secretStore?.getApiKey() ?? null,
  });

  foregroundProbe = new WindowsForegroundProbe();

  sessionService = new SessionService((snapshot) => {
    updateAppWindowProtection(snapshot.focusedSeconds);
    stage3AcceptanceRecorder?.recordSnapshot(snapshot);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session:changed", snapshot);
    }
    // 巡查阶段自动调用巡查编排引擎执行判断
    if (snapshot.phase === "patrolling" && inspectionEngine) {
      void inspectionEngine.inspectOnce().then((result) => {
        const active = sessionService?.getActive();
        if (
          active?.sessionId === snapshot.sessionId &&
          active.phase === "patrolling" &&
          !inspectionEngine?.hasPendingConfirmation()
        ) {
          sessionService?.applyInspectionResult(snapshot.sessionId, result.label);
        }
      }).catch(() => {
        const active = sessionService?.getActive();
        if (active?.sessionId === snapshot.sessionId && active.phase === "patrolling") {
          sessionService?.applyInspectionResult(snapshot.sessionId, "uncertain");
        }
      });
    }
  }, database, (partnerId, totalTrust) => {
    const currentManifest = (activePartnerManifest?.partnerId === partnerId)
      ? activePartnerManifest
      : (bundledDemo?.partnerId === partnerId ? bundledDemo : undefined);
    if (!currentManifest) return "initial";
    const eligible = currentManifest.relationshipLevels
      .filter((level) => level.minimumTrust <= totalTrust)
      .sort((left, right) => right.minimumTrust - left.minimumTrust);
    return eligible[0]?.id ?? currentManifest.relationshipLevels[0]?.id ?? "initial";
  }, stage3Acceptance ? {
    seedFactory: () => stage3Acceptance.seed,
    normalizeSnapshot: (snapshot) => normalizeStage3AcceptanceSnapshot(snapshot, stage3Acceptance.plan),
  } : {});

  registerIpc();
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();
  captureWindow = createCaptureWindow();

  captureService = new ElectronCaptureService(() => captureWindow ?? null, permissionManager);
  if (contentProtectionAcceptance.isEnabled()) {
    console.log('[Acceptance:ContentProtection] {"outcome":"armed","status":"inactive"}');
  }
  captureService.onStatusChange((status) => {
    stage3AcceptanceRecorder?.recordCaptureStatus(status);
    if (contentProtectionAcceptance.isEnabled()) {
      console.log(`[Acceptance:ContentProtection] ${JSON.stringify({ outcome: "status", status })}`);
    }
    if (status === "stopped" || status === "failed") {
      inspectionEngine?.cancelPendingConfirmation(true);
    }
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("capture:status-changed", status);
    }
    if (
      status === "active" &&
      captureService &&
      mainWindow &&
      overlayWindow &&
      !mainWindow.isDestroyed() &&
      !overlayWindow.isDestroyed()
    ) {
      void contentProtectionAcceptance.run(captureService, mainWindow, overlayWindow);
    }
  });

  tray = createTray();

  if (stage3Acceptance) {
    const processType = (process as NodeJS.Process & { type?: string }).type ?? null;
    emitStartupDiagnostics({
      stage: "runtime",
      processType,
      isBrowserProcess: processType === "browser",
      electronVersion: process.versions.electron ?? null,
      nodeVersion: process.versions.node ?? null,
    });
    void app
      .getGPUInfo("basic")
      .then((info) => emitStartupDiagnostics(summarizeGpuInfo(info)))
      .catch(() => emitStartupDiagnostics({ stage: "gpu-info", available: false }));
    void new Stage3StartupDiagnostics(emitStartupDiagnostics, () => mainWindow)
      .run()
      .catch((error) => {
        emitStartupDiagnostics({
          stage: "startup-failed",
          pass: false,
          lastError: error instanceof Error ? error.message.slice(0, 120) : "UNKNOWN_STARTUP_ERROR",
        });
      });
  }
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  mainWindow.show();
});

async function shutdownApplicationResources(): Promise<{
  captureStopped: boolean;
  probeStopped: boolean;
}> {
  if (shutdownPromise) return shutdownPromise;
  shutdownPromise = (async () => {
    stage3AcceptanceRecorder?.finalize();
    overlayVisibility.cancel();
    inspectionEngine?.dispose();
    inspectionEngine = null;

    const [captureStopped, probeStopped] = await Promise.all([
      captureService?.stopCaptureAndWait().catch(() => false) ?? Promise.resolve(true),
      foregroundProbe?.stopAndWait().catch(() => false) ?? Promise.resolve(true),
    ]);

    sessionService?.dispose();
    sessionService = undefined;
    try {
      database?.close();
    } finally {
      database = undefined;
    }
    tray?.destroy();
    tray = undefined;
    if (stage3Acceptance) {
      console.log(`[Acceptance:Stage3:Shutdown] ${JSON.stringify({
        captureStopped,
        probeStopped,
        pass: captureStopped && probeStopped,
      })}`);
    }
    return { captureStopped, probeStopped };
  })();
  return shutdownPromise;
}

app.on("before-quit", (event) => {
  isQuitting = true;
  if (quitAfterShutdown) return;
  event.preventDefault();
  void shutdownApplicationResources().finally(() => {
    quitAfterShutdown = true;
    app.quit();
  });
});

app.on("window-all-closed", () => {
  // Windows MVP keeps the process alive through the tray.
});
}
