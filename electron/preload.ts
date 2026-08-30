import { contextBridge, ipcRenderer } from "electron";
import type {
  BootstrapData,
  ImportResult,
  OverlayPreviewPayload,
  StudyPartnerApi,
} from "../shared/partner-pack.js";
import type {
  ObservationLabel,
  SessionFinishMode,
  SessionHistoryEntry,
  SessionSnapshot,
  PartnerProgressSnapshot,
  StartSessionInput,
} from "../shared/session.js";
import type { AppRule, SaveAppRuleInput } from "../shared/rules.js";

type MainStudyPartnerApi = Omit<StudyPartnerApi,
  | "onOverlayPreview"
  | "onCaptureInitStream"
  | "onCaptureRequestFrame"
  | "onCaptureStopStream"
  | "sendCaptureFrame"
  | "notifyCaptureStreamReady"
  | "notifyCaptureStreamEnded"
>;

const mainApi: MainStudyPartnerApi = {
  getBootstrapData: () => ipcRenderer.invoke("app:get-bootstrap") as Promise<BootstrapData>,
  importPartnerDirectory: () => ipcRenderer.invoke("partner:import-directory") as Promise<ImportResult>,
  listInstalledPartners: () => ipcRenderer.invoke("partner:list") as Promise<any>,
  selectPartner: (partnerId: string) => ipcRenderer.invoke("partner:select", partnerId) as Promise<BootstrapData>,
  showOverlayPreview: (payload) => ipcRenderer.invoke("overlay:show-preview", payload) as Promise<void>,
  hideOverlay: () => ipcRenderer.invoke("overlay:hide") as Promise<void>,
  getActiveSession: () => ipcRenderer.invoke("session:get-active") as Promise<SessionSnapshot | null>,
  startSession: (input: StartSessionInput) => ipcRenderer.invoke("session:start", input) as Promise<SessionSnapshot>,
  pauseSession: (sessionId: string) => ipcRenderer.invoke("session:pause", sessionId) as Promise<SessionSnapshot>,
  resumeSession: (sessionId: string) => ipcRenderer.invoke("session:resume", sessionId) as Promise<SessionSnapshot>,
  previewSessionPatrol: (sessionId: string) => ipcRenderer.invoke("session:preview-patrol", sessionId) as Promise<SessionSnapshot>,
  triggerSessionPatrol: (sessionId: string) => ipcRenderer.invoke("session:trigger-patrol", sessionId) as Promise<SessionSnapshot>,
  recordSessionObservation: (sessionId: string, label: ObservationLabel) => ipcRenderer.invoke("session:record-observation", sessionId, label) as Promise<SessionSnapshot>,
  completeSessionFeedback: (sessionId: string) => ipcRenderer.invoke("session:complete-feedback", sessionId) as Promise<SessionSnapshot>,
  startSessionBreak: (sessionId: string) => ipcRenderer.invoke("session:start-break", sessionId) as Promise<SessionSnapshot>,
  finishSession: (sessionId: string, mode: SessionFinishMode) => ipcRenderer.invoke("session:finish", sessionId, mode) as Promise<SessionSnapshot>,
  listSessionHistory: (limit = 50) => ipcRenderer.invoke("history:list", limit) as Promise<SessionHistoryEntry[]>,
  getPartnerProgress: (partnerId: string) => ipcRenderer.invoke("partner:get-progress", partnerId) as Promise<PartnerProgressSnapshot>,
  listAppRules: () => ipcRenderer.invoke("rules:list") as Promise<AppRule[]>,
  saveAppRule: (input: SaveAppRuleInput) => ipcRenderer.invoke("rules:save", input) as Promise<AppRule>,
  deleteAppRule: (id: string) => ipcRenderer.invoke("rules:delete", id) as Promise<void>,
  listCaptureSources: () => ipcRenderer.invoke("capture:list-sources") as Promise<any>,
  stopCapture: () => ipcRenderer.invoke("capture:stop") as Promise<void>,
  onCaptureStatusChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, status: any) => {
      listener(status);
    };
    ipcRenderer.on("capture:status-changed", handler);
    return () => ipcRenderer.removeListener("capture:status-changed", handler);
  },
  getVisionSettings: () => ipcRenderer.invoke("settings:get-vision") as Promise<any>,
  saveVisionSettings: (input) => ipcRenderer.invoke("settings:save-vision", input) as Promise<any>,
  testVisionConnection: () => ipcRenderer.invoke("settings:test-connection") as Promise<any>,
  listSessionObservations: (sessionId: string) => ipcRenderer.invoke("history:list-observations", sessionId) as Promise<any>,
  onSessionChanged: (listener) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: SessionSnapshot) => {
      listener(snapshot);
    };
    ipcRenderer.on("session:changed", handler);
    return () => ipcRenderer.removeListener("session:changed", handler);
  },
  minimizeWindow: () => ipcRenderer.invoke("window:minimize") as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke("window:toggle-maximize") as Promise<boolean>,
  closeWindow: () => ipcRenderer.invoke("window:close") as Promise<void>,
};

const overlayApi = {
  onOverlayPreview: (listener: (payload: OverlayPreviewPayload) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, payload: OverlayPreviewPayload) => {
      listener(payload);
    };
    ipcRenderer.on("overlay:preview", handler);
    return () => ipcRenderer.removeListener("overlay:preview", handler);
  },
};

const captureApi = {
  onCaptureInitStream: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("capture:init-stream", handler);
    return () => ipcRenderer.removeListener("capture:init-stream", handler);
  },
  onCaptureRequestFrame: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("capture:request-frame", handler);
    return () => ipcRenderer.removeListener("capture:request-frame", handler);
  },
  onCaptureStopStream: (listener: () => void) => {
    const handler = () => listener();
    ipcRenderer.on("capture:stop-stream", handler);
    return () => ipcRenderer.removeListener("capture:stop-stream", handler);
  },
  sendCaptureFrame: (frameData: Uint8Array | null) =>
    ipcRenderer.invoke("capture:send-frame", frameData) as Promise<void>,
  notifyCaptureStreamReady: () => ipcRenderer.invoke("capture:stream-ready") as Promise<void>,
  notifyCaptureStreamEnded: () => ipcRenderer.invoke("capture:stream-ended") as Promise<void>,
};

const viewArgument = process.argv.find((argument) => argument.startsWith("--xingban-view="));
const view = viewArgument?.slice("--xingban-view=".length);
contextBridge.exposeInMainWorld(
  "studyPartner",
  view === "capture" ? captureApi : view === "overlay" ? overlayApi : mainApi,
);
