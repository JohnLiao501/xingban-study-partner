import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  nativeImage,
  session,
  shell,
  Tray,
  type IpcMainInvokeEvent,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  REACTION_KEYS,
  type OverlayPreviewPayload,
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
  installPackDirectory,
  loadBundledDemo,
} from "./partner-pack/service.js";
import { SessionService } from "./session/service.js";
import { XingbanDatabase } from "./storage/database.js";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(currentDirectory, "..", "..");
const preloadPath = path.join(currentDirectory, "preload.js");
const rendererPath = path.join(projectRoot, "dist-renderer", "index.html");
const schemaPath = path.join(projectRoot, "schemas", "partner-pack.v1.schema.json");

let mainWindow: BrowserWindow | undefined;
let overlayWindow: BrowserWindow | undefined;
let captureWindow: BrowserWindow | undefined;
let tray: Tray | undefined;
let isQuitting = false;
let sessionService: SessionService | undefined;
let database: XingbanDatabase | undefined;
let bundledDemo: Awaited<ReturnType<typeof loadBundledDemo>> | undefined;

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
  window.once("ready-to-show", () => window.show());
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
  ipcMain.handle("app:get-bootstrap", async () => ({
    manifest: bundledDemo ?? await loadBundledDemo(projectRoot),
    assetBaseUrl: "./",
    desktopRuntime: true,
  }));

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
    return installPackDirectory(result.filePaths[0], installRoot, schemaPath);
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
  ipcMain.handle("session:start", (_event, input: unknown) => {
    if (!isStartSessionInput(input)) throw new Error("IPC_INVALID_PAYLOAD");
    return sessionService?.start(input);
  });
  ipcMain.handle("session:pause", (_event, sessionId: unknown) =>
    sessionService?.pause(requireSessionId(sessionId)));
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
  ipcMain.handle("session:finish", (_event, sessionId: unknown, mode: unknown) => {
    if (mode !== "completed" && mode !== "aborted" && mode !== "interrupted") {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return sessionService?.finish(requireSessionId(sessionId), mode as SessionFinishMode);
  });
  ipcMain.handle("history:list", (_event, limit: unknown) => {
    if (limit !== undefined && (typeof limit !== "number" || !Number.isInteger(limit))) {
      throw new Error("IPC_INVALID_PAYLOAD");
    }
    return database?.listSessionHistory(limit ?? 50) ?? [];
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

app.setAppUserModelId("com.xingban.study-partner");

app.whenReady().then(async () => {
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  bundledDemo = await loadBundledDemo(projectRoot);
  database = new XingbanDatabase(path.join(app.getPath("userData"), "xingban.sqlite3"));
  sessionService = new SessionService((snapshot) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("session:changed", snapshot);
    }
  }, database, (partnerId, totalTrust) => {
    if (bundledDemo?.partnerId !== partnerId) return "initial";
    const eligible = bundledDemo.relationshipLevels
      .filter((level) => level.minimumTrust <= totalTrust)
      .sort((left, right) => right.minimumTrust - left.minimumTrust);
    return eligible[0]?.id ?? bundledDemo.relationshipLevels[0]?.id ?? "initial";
  });
  registerIpc();
  mainWindow = createMainWindow();
  overlayWindow = createOverlayWindow();
  captureWindow = createCaptureWindow();
  tray = createTray();
});

app.on("activate", () => {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createMainWindow();
  mainWindow.show();
});

app.on("before-quit", () => {
  isQuitting = true;
  sessionService?.dispose();
  database?.close();
});

app.on("window-all-closed", () => {
  // Windows MVP keeps the process alive through the tray.
});
