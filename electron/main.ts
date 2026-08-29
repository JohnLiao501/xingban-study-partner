import {
  app,
  BrowserWindow,
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
  OBSERVATION_LABELS,
  type ObservationLabel,
  type SessionFinishMode,
  type StartSessionInput,
} from "../shared/session.js";
import {
  RULE_DECISIONS,
  RULE_MATCH_TYPES,
  type RuleDecision,
  type RuleMatchType,
  type SaveAppRuleInput,
} from "../shared/rules.js";
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
import { OpenAiVisionAdapter } from "./vision/openai-vision-adapter.js";
import { WindowsForegroundProbe } from "./inspection/windows-foreground-probe.js";
import { LocalRuleClassifier } from "./inspection/local-rule-classifier.js";
import { InspectionEngine } from "./inspection/inspection-engine.js";
import { mapInspectionToObservationParams } from "./inspection/observation.js";
import type { SaveVisionSettingsInput, VisionSettingsView } from "../shared/inspection.js";

protocol.registerSchemesAsPrivileged([
  {
    scheme: "partner-asset",
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      bypassCSP: true,
    },
  },
]);




const permissionManager = new PermissionManager();
let captureService: ElectronCaptureService | null = null;
let secretStore: SecretStore | null = null;
let visionAdapter: OpenAiVisionAdapter | null = null;
let foregroundProbe: WindowsForegroundProbe | null = null;
let inspectionEngine: InspectionEngine | null = null;

const SETTINGS_KEY_VISION = "vision_settings";
const DEFAULT_VISION_CONFIG = {
  baseUrl: "https://api.openai.com/v1",
  model: "gpt-4o",
  sendWindowTitle: false,
  visionEnabled: false,
  timeoutMs: 10000,
};

let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let captureWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let sessionService: SessionService | undefined;
let database: XingbanDatabase | undefined;
let bundledDemo: Awaited<ReturnType<typeof loadBundledDemo>> | undefined;
let activePartnerManifest: PartnerPackManifestV1 | undefined;
const partnerDirectoryMap = new Map<string, string>();

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
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
      <path fill="#79bbff" d="M16 2l3.1 8.9L28 14l-8.9 3.1L16 26l-3.1-8.9L4 14l8.9-3.1L16 2z"/>
      <circle cx="16" cy="14" r="3.2" fill="#f7fbff"/>
    </svg>`;
  return nativeImage
    .createFromDataURL(`data:image/svg+xml;base64,${Buffer.from(svg).toString("base64")}`)
    .resize({ width: 16, height: 16 });
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

async function loadRenderer(window: BrowserWindow, view?: "overlay" | "capture"): Promise<void> {
  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) {
    const url = new URL(developmentUrl);
    if (view) url.searchParams.set("view", view);
    await window.loadURL(url.toString());
  } else {
    await window.loadFile(rendererPath, view ? { query: { view } } : undefined);
  }
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
    },
  });
  window.setContentProtection(true);
  hardenWindow(window);
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription) => {
    console.error("[MainWindow] Failed to load renderer:", errorCode, errorDescription);
  });
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    console.log(`[RendererConsole level=${level}] ${message} (${sourceId}:${line})`);
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
    },
  });
  window.setAlwaysOnTop(true, "floating");
  window.setContentProtection(true);
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
    },
  });
  window.setContentProtection(true);
  permissionManager.setCaptureWebContentsId(window.webContents.id);
  hardenWindow(window);
  void loadRenderer(window, "capture");
  return window;
}

function createTray(): Tray {
  const appTray = new Tray(createTrayIcon());
  appTray.setToolTip("星伴");
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
      click: () => overlayWindow?.hide(),
    },
    {
      label: "停止屏幕巡查",
      click: () => {
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

function senderWindow(event: IpcMainInvokeEvent): BrowserWindow | undefined {
  return BrowserWindow.fromWebContents(event.sender) ?? undefined;
}

function isOverlayPayload(value: unknown): value is OverlayPreviewPayload {
  if (!value || typeof value !== "object") return false;
  const payload = value as Partial<OverlayPreviewPayload>;
  return typeof payload.reactionKey === "string" &&
    REACTION_KEYS.includes(payload.reactionKey as ReactionKey) &&
    typeof payload.label === "string" &&
    typeof payload.line === "string" &&
    typeof payload.videoPath === "string" &&
    typeof payload.loop === "boolean";
}

function isStartSessionInput(value: unknown): value is StartSessionInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<StartSessionInput>;
  return typeof input.partnerId === "string" &&
    typeof input.packVersion === "string" &&
    typeof input.sceneId === "string" &&
    typeof input.goal === "string" &&
    typeof input.plannedMinutes === "number";
}

function requireSessionId(value: unknown): string {
  if (typeof value !== "string" || value.length < 1 || value.length > 100) {
    throw new Error("IPC_INVALID_PAYLOAD");
  }
  return value;
}

function isSaveAppRuleInput(value: unknown): value is SaveAppRuleInput {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<SaveAppRuleInput>;
  return (input.id === undefined || typeof input.id === "string") &&
    typeof input.pattern === "string" &&
    typeof input.enabled === "boolean" &&
    typeof input.matchType === "string" &&
    RULE_MATCH_TYPES.includes(input.matchType as RuleMatchType) &&
    typeof input.decision === "string" &&
    RULE_DECISIONS.includes(input.decision as RuleDecision);
}

function registerIpc(): void {
  ipcMain.handle("app:get-bootstrap", async (): Promise<BootstrapData> => {
    const currentManifest = activePartnerManifest ?? bundledDemo ?? await loadBundledDemo(projectRoot);
    return {
      manifest: currentManifest,
      assetBaseUrl: `partner-asset://${currentManifest.partnerId}/`,
      desktopRuntime: true,
    };
  });

  ipcMain.handle("partner:list", async (): Promise<InstalledPartnerSummary[]> => {
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

  ipcMain.handle("partner:select", async (_event, partnerId: unknown): Promise<BootstrapData> => {
    if (typeof partnerId !== "string" || partnerId.length < 1 || partnerId.length > 120) {
      throw new Error("IPC_INVALID_PAYLOAD");
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
    };
  });

  ipcMain.handle("partner:import-directory", async () => {
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


  ipcMain.handle("overlay:show-preview", async (_event, payload: unknown) => {
    if (!isOverlayPayload(payload)) throw new Error("IPC_INVALID_PAYLOAD");
    if (!overlayWindow || overlayWindow.isDestroyed()) overlayWindow = createOverlayWindow();
    const send = () => overlayWindow?.webContents.send("overlay:preview", payload);
    if (overlayWindow.webContents.isLoading()) {
      overlayWindow.webContents.once("did-finish-load", send);
    } else {
      send();
    }
    overlayWindow.showInactive();
  });
  ipcMain.handle("overlay:hide", () => overlayWindow?.hide());
  ipcMain.handle("session:get-active", () => sessionService?.getActive() ?? null);
  ipcMain.handle("session:start", async (_event, input: unknown) => {
    if (!isStartSessionInput(input)) throw new Error("IPC_INVALID_PAYLOAD");

    // 1. 若选择了屏幕，启动捕获服务
    if (input.captureSourceId && captureService) {
      await captureService.startCapture(input.captureSourceId);
    }

    // 2. 启动 Windows 前台探针
    try {
      foregroundProbe?.start(() => {});
    } catch {}

    // 3. 启动会话核心
    const snapshot = sessionService?.start(input);
    if (!snapshot) return null;

    // 4. 组装并初始化 InspectionEngine
    const allRules = database?.listAppRules() ?? [];
    const activeRules = allRules.filter((r) => {
      if (!r.enabled) return false;
      if (r.decision === "allow" && input.allowRuleIds) return input.allowRuleIds.includes(r.id);
      if (r.decision === "block" && input.blockRuleIds) return input.blockRuleIds.includes(r.id);
      return true;
    });

    if (foregroundProbe && captureService && visionAdapter) {
      inspectionEngine = new InspectionEngine({
        sessionId: snapshot.sessionId,
        goal: snapshot.goal,
        visionEnabled: Boolean(input.visionEnabled),
        sendWindowTitle: Boolean(input.sendWindowTitle),
        rules: activeRules,
        probe: foregroundProbe,
        classifier: new LocalRuleClassifier(),
        captureService,
        visionAdapter,
        onConfirmDeviation: (id) => {
          sessionService?.recordObservation(id, "distracted");
        },
        onObservation: (result, confirmed) => {
          if (database) {
            database.recordStructuredObservation(
              mapInspectionToObservationParams(snapshot.sessionId, result, confirmed),
            );
          }
        },
      });
    }

    return snapshot;
  });
  ipcMain.handle("session:pause", (_event, sessionId: unknown) => {
    inspectionEngine?.cancelPendingConfirmation();
    return sessionService?.pause(requireSessionId(sessionId));
  });
  ipcMain.handle("session:resume", (_event, sessionId: unknown) =>
    sessionService?.resume(requireSessionId(sessionId)));
  ipcMain.handle("session:preview-patrol", (_event, sessionId: unknown) =>
    sessionService?.previewPatrol(requireSessionId(sessionId)));
  ipcMain.handle("session:trigger-patrol", (_event, sessionId: unknown) =>
    sessionService?.triggerPatrol(requireSessionId(sessionId)));
  ipcMain.handle("session:record-observation", (_event, sessionId: unknown, label: unknown) => {
    if (typeof label !== "string" || !OBSERVATION_LABELS.includes(label as ObservationLabel)) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return sessionService?.recordObservation(requireSessionId(sessionId), label as ObservationLabel);
  });
  ipcMain.handle("session:complete-feedback", (_event, sessionId: unknown) =>
    sessionService?.completeFeedback(requireSessionId(sessionId)));
  ipcMain.handle("session:start-break", (_event, sessionId: unknown) =>
    sessionService?.startBreak(requireSessionId(sessionId)));
  ipcMain.handle("session:finish", async (_event, sessionId: unknown, mode: unknown) => {
    if (mode !== "completed" && mode !== "aborted" && mode !== "interrupted") {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    inspectionEngine?.dispose();
    inspectionEngine = null;
    await captureService?.stopCapture();
    foregroundProbe?.stop();
    return sessionService?.finish(requireSessionId(sessionId), mode as SessionFinishMode);
  });
  ipcMain.handle("history:list", (_event, limit: unknown) => {
    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit))) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return database?.listSessionHistory(limit ?? 50) ?? [];
  });
  ipcMain.handle("history:list-observations", (_event, sessionId: unknown) => {
    return database?.listSessionObservations(requireSessionId(sessionId)) ?? [];
  });
  ipcMain.handle("partner:get-progress", (_event, partnerId: unknown) => {
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
  ipcMain.handle("rules:list", () => database?.listAppRules() ?? []);
  ipcMain.handle("rules:save", (_event, input: unknown) => {
    if (!isSaveAppRuleInput(input)) throw new Error("IPC_INVALID_PAYLOAD");
    return database?.saveAppRule(input);
  });
  ipcMain.handle("rules:delete", (_event, id: unknown) => {
    if (typeof id !== "string" || id.length < 1 || id.length > 100) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    database?.deleteAppRule(id);
  });
  ipcMain.handle("capture:list-sources", async () => {
    return captureService ? await captureService.listSources() : [];
  });
  ipcMain.handle("capture:stop", async () => {
    await captureService?.stopCapture();
  });
  ipcMain.handle("capture:send-frame", (_event, frameData: unknown) => {
    if (frameData instanceof Uint8Array || frameData === null) {
      captureService?.handleIncomingFrame(frameData);
    }
  });
  ipcMain.handle("capture:stream-ended", () => {
    captureService?.handleStreamEnded();
  });
  ipcMain.handle("settings:get-vision", (): VisionSettingsView => {
    let savedConfig = DEFAULT_VISION_CONFIG;
    const raw = database?.getAppSetting(SETTINGS_KEY_VISION);
    if (raw) {
      try {
        savedConfig = { ...DEFAULT_VISION_CONFIG, ...JSON.parse(raw) };
      } catch {}
    }
    return {
      baseUrl: savedConfig.baseUrl,
      model: savedConfig.model,
      apiKeyConfigured: secretStore?.hasApiKey() ?? false,
      sendWindowTitle: savedConfig.sendWindowTitle,
      visionEnabled: savedConfig.visionEnabled,
      timeoutMs: savedConfig.timeoutMs,
    };
  });
  ipcMain.handle("settings:save-vision", (_event, input: SaveVisionSettingsInput): VisionSettingsView => {
    if (!database || !secretStore) throw new Error("DB_NOT_INITIALIZED");

    if (input.clearApiKey) {
      secretStore.clearApiKey();
    } else if (input.apiKey && input.apiKey.trim()) {
      secretStore.setApiKey(input.apiKey);
    }

    const configToSave = {
      baseUrl: input.baseUrl.trim(),
      model: input.model.trim(),
      sendWindowTitle: Boolean(input.sendWindowTitle),
      visionEnabled: Boolean(input.visionEnabled),
      timeoutMs: Math.max(2000, Math.min(60000, Number(input.timeoutMs) || 10000)),
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
  ipcMain.handle("settings:test-connection", async () => {
    if (!visionAdapter) return { ok: false, message: "适配器未初始化" };
    return await visionAdapter.testConnection();
  });
  ipcMain.handle("window:minimize", (event) => senderWindow(event)?.minimize());
  ipcMain.handle("window:toggle-maximize", (event) => {
    const window = senderWindow(event);
    if (!window) return false;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
    return window.isMaximized();
  });
  ipcMain.handle("window:close", (event) => senderWindow(event)?.close());
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

  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permissionManager.shouldAllowPermission(
      webContents.id,
      permission,
      details as { mediaTypes?: string[] },
    );
    callback(allowed);
  });
  bundledDemo = await loadBundledDemo(projectRoot);
  database = new XingbanDatabase(path.join(app.getPath("userData"), "xingban.sqlite3"));
  secretStore = new SecretStore(database);

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

  let initialVision = DEFAULT_VISION_CONFIG;
  const rawVision = database.getAppSetting(SETTINGS_KEY_VISION);
  if (rawVision) {
    try {
      initialVision = { ...DEFAULT_VISION_CONFIG, ...JSON.parse(rawVision) };
    } catch {}
  }

  visionAdapter = new OpenAiVisionAdapter({
    baseUrl: initialVision.baseUrl,
    model: initialVision.model,
    timeoutMs: initialVision.timeoutMs,
    getApiKey: () => secretStore?.getApiKey() ?? null,
  });

  foregroundProbe = new WindowsForegroundProbe();

  sessionService = new SessionService((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session:changed", snapshot);
    }
    // 巡查阶段自动调用巡查编排引擎执行判断
    if (snapshot.phase === "patrolling" && inspectionEngine) {
      void inspectionEngine.inspectOnce().then((result) => {
        if (sessionService?.getActive()?.phase === "patrolling") {
          sessionService.recordObservation(snapshot.sessionId, result.label);
        }
      }).catch(() => {
        if (sessionService?.getActive()?.phase === "patrolling") {
          sessionService.recordObservation(snapshot.sessionId, "uncertain");
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
  });

  registerIpc();
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();
  captureWindow = createCaptureWindow();

  captureService = new ElectronCaptureService(() => captureWindow ?? null, permissionManager);
  captureService.onStatusChange((status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("capture:status-changed", status);
    }
  });

  tray = createTray();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  mainWindow.show();
});

app.on("before-quit", () => {
  isQuitting = true;
  inspectionEngine?.dispose();
  inspectionEngine = null;
  foregroundProbe?.stop();
  void captureService?.stopCapture();
  sessionService?.dispose();
  database?.close();
});

app.on("window-all-closed", () => {
  // Windows MVP keeps the process alive through the tray.
});
}

