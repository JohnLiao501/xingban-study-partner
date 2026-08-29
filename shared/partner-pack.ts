export const REACTION_KEYS = [
  "idle_loop",
  "session_start",
  "patrol_enter",
  "focus_confirmed",
  "uncertain_nudge",
  "distracted_warning",
  "recovery",
  "break_invite",
  "session_complete",
  "session_partial",
] as const;

export type ReactionKey = (typeof REACTION_KEYS)[number];

export const REACTION_LABELS: Record<ReactionKey, string> = {
  idle_loop: "待机",
  session_start: "开工",
  patrol_enter: "巡查出现",
  focus_confirmed: "专注确认",
  uncertain_nudge: "不确定提醒",
  distracted_warning: "分心警告",
  recovery: "恢复专注",
  break_invite: "休息邀请",
  session_complete: "完成结算",
  session_partial: "部分完成",
};

export interface Persona {
  summary: string;
  defaultTone: "gentle" | "dynamic" | "strict";
  styleRules: string[];
  boundaries: string[];
}

export interface VoiceConfig {
  mode: "subtitle-only" | "original-tts";
  language: string;
  clonedRealPerson: false;
}

export interface RelationshipLevel {
  id: string;
  displayName: string;
  minimumTrust: number;
  unlockNote?: string;
}

export interface ReactionVariant {
  variantId: string;
  videoAssetId: string;
  lineIds: string[];
  weight: number;
  minimumTrust: number;
}

export interface SceneVariant {
  id: string;
  displayName: string;
  description: string;
  coverAssetId: string;
  reactions: Record<ReactionKey, ReactionVariant[]>;
}

export interface MediaAsset {
  id: string;
  kind: "video" | "audio" | "image";
  filePath: string;
  mimeType: string;
  codec: string;
  durationMs?: number;
  width?: number;
  height?: number;
  fps?: number;
  loop?: boolean;
}

export interface PartnerLine {
  id: string;
  reactionKey: ReactionKey;
  text: string;
  audioAssetId?: string;
  weight: number;
  cooldownSeconds: number;
}

export interface PackFileEntry {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface PartnerPackManifestV1 {
  $schema?: string;
  schemaVersion: 1;
  partnerId: string;
  packVersion: string;
  minimumAppVersion: string;
  displayName: string;
  description: string;
  sourceType: "private-fan" | "original";
  distribution: "private-only" | "redistributable";
  rightsNotice: string;
  author: { name: string; url?: string };
  capabilities: {
    preRenderedVideo: boolean;
    originalTts: boolean;
    multipleScenes: boolean;
    cameraRequired: false;
  };
  persona: Persona;
  voice: VoiceConfig;
  relationshipLevels: RelationshipLevel[];
  sceneVariants: SceneVariant[];
  mediaAssets: MediaAsset[];
  lines: PartnerLine[];
  files: PackFileEntry[];
}

export interface BootstrapData {
  manifest: PartnerPackManifestV1;
  assetBaseUrl: string;
  desktopRuntime: boolean;
}

export interface PackValidationResult {
  ok: boolean;
  manifest?: PartnerPackManifestV1;
  errors: string[];
}

export interface ImportResult extends PackValidationResult {
  installedPath?: string;
  cancelled?: boolean;
}

export interface OverlayPreviewPayload {
  reactionKey: ReactionKey;
  label: string;
  line: string;
  videoPath: string;
  loop: boolean;
}

import type { SessionControllerApi } from "./session.js";
import type { AppRuleApi } from "./rules.js";
import type { CaptureControllerApi } from "./inspection.js";

export interface StudyPartnerApi extends SessionControllerApi, AppRuleApi, CaptureControllerApi {
  getBootstrapData: () => Promise<BootstrapData>;
  importPartnerDirectory: () => Promise<ImportResult>;
  showOverlayPreview: (payload: OverlayPreviewPayload) => Promise<void>;
  hideOverlay: () => Promise<void>;
  onOverlayPreview: (listener: (payload: OverlayPreviewPayload) => void) => () => void;
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<boolean>;
  closeWindow: () => Promise<void>;
}
