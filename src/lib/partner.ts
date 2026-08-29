import {
  type BootstrapData,
  type MediaAsset,
  type PartnerLine,
  type PartnerPackManifestV1,
  type ReactionKey,
} from "../../shared/partner-pack";

export interface ReactionPreview {
  reactionKey: ReactionKey;
  variantId: string;
  video: MediaAsset;
  line: PartnerLine;
}

export function findReactionPreview(
  manifest: PartnerPackManifestV1,
  sceneId: string,
  reactionKey: ReactionKey,
): ReactionPreview | undefined {
  const scene = manifest.sceneVariants.find((candidate) => candidate.id === sceneId);
  const variant = scene?.reactions[reactionKey]?.find((candidate) => candidate.minimumTrust === 0)
    ?? scene?.reactions[reactionKey]?.[0];
  if (!variant) return undefined;

  const video = manifest.mediaAssets.find(
    (asset) => asset.id === variant.videoAssetId && asset.kind === "video",
  );
  const line = variant.lineIds
    .map((lineId) => manifest.lines.find((candidate) => candidate.id === lineId))
    .find((candidate): candidate is PartnerLine => Boolean(candidate));
  if (!video || !line) return undefined;

  return {
    reactionKey,
    variantId: variant.variantId,
    video,
    line,
  };
}

export function resolveAssetUrl(filePath: string, baseUrl?: string): string {
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(filePath)) {
    return filePath;
  }
  let base = window.location.href;
  if (baseUrl && baseUrl.trim().length > 0) {
    try {
      base = new URL(baseUrl, window.location.href).href;
    } catch {
      base = window.location.href;
    }
  }
  return new URL(filePath, base.endsWith("/") ? base : `${base}/`).href;
}



export async function loadBootstrapData(): Promise<BootstrapData> {
  if (window.studyPartner) return window.studyPartner.getBootstrapData();
  const response = await fetch(new URL("manifest.json", window.location.href));
  if (!response.ok) throw new Error(`无法读取 demo 伙伴包：HTTP ${response.status}`);
  return {
    manifest: await response.json() as PartnerPackManifestV1,
    assetBaseUrl: "./",
    desktopRuntime: false,
  };
}

export function formatMediaTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "00:00";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.floor(seconds % 60);
  return `${String(minutes).padStart(2, "0")}:${String(remainingSeconds).padStart(2, "0")}`;
}
