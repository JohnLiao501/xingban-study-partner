import { Ajv2020, type ErrorObject } from "ajv/dist/2020.js";
import {
  REACTION_KEYS,
  type PartnerPackManifestV1,
  type PackValidationResult,
} from "../../shared/partner-pack.js";

const SAFE_RELATIVE_PATH = /^[A-Za-z0-9_][A-Za-z0-9._/-]*$/;
const ALLOWED_EXTENSIONS = new Set([".webp", ".mp4", ".ogg"]);

function formatSchemaError(error: ErrorObject): string {
  const location = error.instancePath || "/";
  return `SCHEMA_INVALID ${location}: ${error.message ?? "校验失败"}`;
}

function parseVersion(version: string): [number, number, number] | undefined {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  if (!match) return undefined;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(left: string, right: string): number {
  const leftParts = parseVersion(left);
  const rightParts = parseVersion(right);
  if (!leftParts || !rightParts) return Number.NaN;

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = leftParts[index] - rightParts[index];
    if (difference !== 0) return difference;
  }
  return 0;
}

export function isSafePackPath(filePath: string): boolean {
  if (!SAFE_RELATIVE_PATH.test(filePath)) return false;
  if (filePath.includes("\\") || filePath.startsWith("/") || /^[A-Za-z]:/.test(filePath)) {
    return false;
  }
  const segments = filePath.split("/");
  return segments.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

function extensionOf(filePath: string): string {
  const dotIndex = filePath.lastIndexOf(".");
  return dotIndex === -1 ? "" : filePath.slice(dotIndex).toLowerCase();
}

function addDuplicateErrors(
  values: readonly string[],
  label: string,
  errors: string[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) errors.push(`PACK_DUPLICATE_ID ${label}: ${value}`);
    seen.add(value);
  }
}

function validateSemanticLinks(manifest: PartnerPackManifestV1): string[] {
  const errors: string[] = [];
  const mediaById = new Map(manifest.mediaAssets.map((asset) => [asset.id, asset]));
  const linesById = new Map(manifest.lines.map((line) => [line.id, line]));

  addDuplicateErrors(manifest.mediaAssets.map((asset) => asset.id), "media", errors);
  addDuplicateErrors(manifest.lines.map((line) => line.id), "line", errors);
  addDuplicateErrors(manifest.sceneVariants.map((scene) => scene.id), "scene", errors);
  addDuplicateErrors(manifest.relationshipLevels.map((level) => level.id), "relationship", errors);

  const variantIds: string[] = [];
  for (const scene of manifest.sceneVariants) {
    const cover = mediaById.get(scene.coverAssetId);
    if (!cover || cover.kind !== "image") {
      errors.push(`PACK_REFERENCE_INVALID scene ${scene.id} coverAssetId`);
    }

    for (const reactionKey of REACTION_KEYS) {
      const variants = scene.reactions[reactionKey];
      if (!variants?.length) {
        errors.push(`PACK_REACTION_MISSING ${scene.id}: ${reactionKey}`);
        continue;
      }
      if (!variants.some((variant) => variant.minimumTrust === 0)) {
        errors.push(`PACK_REACTION_LOCKED ${scene.id}: ${reactionKey}`);
      }

      for (const variant of variants) {
        variantIds.push(variant.variantId);
        const video = mediaById.get(variant.videoAssetId);
        if (!video || video.kind !== "video") {
          errors.push(`PACK_REFERENCE_INVALID variant ${variant.variantId} videoAssetId`);
        }
        for (const lineId of variant.lineIds) {
          const line = linesById.get(lineId);
          if (!line) {
            errors.push(`PACK_REFERENCE_INVALID variant ${variant.variantId} line ${lineId}`);
          } else if (line.reactionKey !== reactionKey) {
            errors.push(`PACK_REACTION_MISMATCH ${lineId}: ${line.reactionKey} != ${reactionKey}`);
          }
        }
      }
    }
  }
  addDuplicateErrors(variantIds, "variant", errors);

  const filePaths = new Set(manifest.files.map((file) => file.path));
  const assetPaths = new Set(manifest.mediaAssets.map((asset) => asset.filePath));
  addDuplicateErrors(manifest.files.map((file) => file.path), "file", errors);
  addDuplicateErrors(manifest.mediaAssets.map((asset) => asset.filePath), "asset-path", errors);

  for (const path of filePaths) {
    if (!isSafePackPath(path)) errors.push(`PACK_PATH_UNSAFE ${path}`);
    if (!ALLOWED_EXTENSIONS.has(extensionOf(path))) errors.push(`PACK_FILE_FORBIDDEN ${path}`);
    if (!assetPaths.has(path)) errors.push(`PACK_FILE_UNREFERENCED ${path}`);
  }
  for (const path of assetPaths) {
    if (!isSafePackPath(path)) errors.push(`PACK_PATH_UNSAFE ${path}`);
    if (!filePaths.has(path)) errors.push(`PACK_FILE_MISSING_ENTRY ${path}`);
  }

  const levels = manifest.relationshipLevels;
  if (levels[0]?.minimumTrust !== 0) errors.push("PACK_RELATIONSHIP_FIRST_NOT_ZERO");
  for (let index = 1; index < levels.length; index += 1) {
    if (levels[index].minimumTrust <= levels[index - 1].minimumTrust) {
      errors.push("PACK_RELATIONSHIP_NOT_ASCENDING");
      break;
    }
  }

  if (manifest.capabilities.multipleScenes !== (manifest.sceneVariants.length > 1)) {
    errors.push("PACK_CAPABILITY_SCENE_MISMATCH");
  }
  return errors;
}

export function validatePartnerManifest(
  schema: object,
  candidate: unknown,
  currentAppVersion: string,
): PackValidationResult {
  const ajv = new Ajv2020({
    allErrors: true,
    strict: true,
    strictRequired: false,
    validateFormats: false,
  });
  const validate = ajv.compile<PartnerPackManifestV1>(schema);
  if (!validate(candidate)) {
    return {
      ok: false,
      errors: (validate.errors ?? []).map(formatSchemaError),
    };
  }

  const errors = validateSemanticLinks(candidate);
  const versionComparison = compareVersions(candidate.minimumAppVersion, currentAppVersion);
  if (!Number.isFinite(versionComparison) || versionComparison > 0) {
    errors.push(
      `PACK_VERSION_INCOMPATIBLE requires ${candidate.minimumAppVersion}, current ${currentAppVersion}`,
    );
  }

  return {
    ok: errors.length === 0,
    manifest: candidate,
    errors,
  };
}
