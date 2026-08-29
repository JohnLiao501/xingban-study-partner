import { createHash, randomUUID } from "node:crypto";
import { cp, lstat, mkdir, open, readFile, readdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import type {
  PartnerPackManifestV1,
  PackValidationResult,
} from "../../shared/partner-pack.js";
import { isSafePackPath, validatePartnerManifest } from "./validator.js";

const APP_VERSION = "0.1.0";

function resolveContained(root: string, relativePath: string): string {
  if (!isSafePackPath(relativePath)) throw new Error(`PACK_PATH_UNSAFE ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, ...relativePath.split("/"));
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`PACK_PATH_UNSAFE ${relativePath}`);
  }
  return resolvedPath;
}

async function sha256(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function verifyMediaSignature(filePath: string, extension: string): Promise<boolean> {
  const handle = await open(filePath, "r");
  const buffer = Buffer.alloc(12);
  try {
    await handle.read(buffer, 0, buffer.length, 0);
  } finally {
    await handle.close();
  }

  if (extension === ".webp") {
    return buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP";
  }
  if (extension === ".mp4") return buffer.subarray(4, 8).toString("ascii") === "ftyp";
  if (extension === ".ogg") return buffer.subarray(0, 4).toString("ascii") === "OggS";
  return false;
}

async function listAssetFiles(root: string, directory = "assets"): Promise<string[]> {
  const absoluteDirectory = resolveContained(root, directory);
  const entries = await readdir(absoluteDirectory, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const relativePath = `${directory}/${entry.name}`;
    const absolutePath = resolveContained(root, relativePath);
    const fileStat = await lstat(absolutePath);
    if (fileStat.isSymbolicLink()) throw new Error(`PACK_SYMLINK_FORBIDDEN ${relativePath}`);
    if (entry.isDirectory()) {
      files.push(...await listAssetFiles(root, relativePath));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function validatePackDirectory(
  root: string,
  schemaPath: string,
  currentAppVersion = APP_VERSION,
): Promise<PackValidationResult> {
  try {
    const schema = await readJson(schemaPath);
    const candidate = await readJson(path.join(root, "manifest.json"));
    const manifestResult = validatePartnerManifest(schema as object, candidate, currentAppVersion);
    if (!manifestResult.ok || !manifestResult.manifest) return manifestResult;

    const manifest = manifestResult.manifest;
    const errors: string[] = [];
    const declaredPaths = new Set(manifest.files.map((file) => file.path));
    const actualPaths = new Set(await listAssetFiles(root));

    for (const file of manifest.files) {
      const absolutePath = resolveContained(root, file.path);
      try {
        const fileStat = await stat(absolutePath);
        if (!fileStat.isFile()) {
          errors.push(`PACK_FILE_NOT_REGULAR ${file.path}`);
          continue;
        }
        if (fileStat.size !== file.sizeBytes) {
          errors.push(`PACK_FILE_SIZE_MISMATCH ${file.path}`);
        }
        if (await sha256(absolutePath) !== file.sha256) {
          errors.push(`PACK_FILE_HASH_MISMATCH ${file.path}`);
        }
        if (!await verifyMediaSignature(absolutePath, path.extname(file.path).toLowerCase())) {
          errors.push(`PACK_MEDIA_SIGNATURE_INVALID ${file.path}`);
        }
      } catch (error) {
        errors.push(
          error instanceof Error && error.message.startsWith("PACK_")
            ? error.message
            : `PACK_FILE_MISSING ${file.path}`,
        );
      }
    }

    for (const actualPath of actualPaths) {
      if (!declaredPaths.has(actualPath)) errors.push(`PACK_FILE_UNDECLARED ${actualPath}`);
    }

    return { ok: errors.length === 0, manifest, errors };
  } catch (error) {
    return {
      ok: false,
      errors: [error instanceof Error ? error.message : "PACK_VALIDATION_FAILED"],
    };
  }
}

export async function installPackDirectory(
  sourceRoot: string,
  installRoot: string,
  schemaPath: string,
): Promise<PackValidationResult & { installedPath?: string }> {
  const sourceValidation = await validatePackDirectory(sourceRoot, schemaPath);
  if (!sourceValidation.ok || !sourceValidation.manifest) return sourceValidation;

  const { partnerId, packVersion } = sourceValidation.manifest;
  const partnerRoot = path.join(installRoot, partnerId);
  const destination = path.join(partnerRoot, packVersion);
  const temporary = path.join(installRoot, `.install-${randomUUID()}`);
  await mkdir(installRoot, { recursive: true });

  try {
    try {
      await stat(destination);
      return {
        ok: false,
        manifest: sourceValidation.manifest,
        errors: [`PACK_VERSION_CONFLICT ${partnerId}@${packVersion}`],
      };
    } catch {
      // Destination does not exist, so installation can continue.
    }

    await cp(sourceRoot, temporary, {
      recursive: true,
      errorOnExist: true,
      force: false,
      verbatimSymlinks: true,
    });
    const copiedValidation = await validatePackDirectory(temporary, schemaPath);
    if (!copiedValidation.ok) return copiedValidation;

    await mkdir(partnerRoot, { recursive: true });
    await rename(temporary, destination);
    return {
      ok: true,
      manifest: copiedValidation.manifest,
      errors: [],
      installedPath: destination,
    };
  } finally {
    const resolvedInstallRoot = path.resolve(installRoot);
    const resolvedTemporary = path.resolve(temporary);
    if (resolvedTemporary.startsWith(`${resolvedInstallRoot}${path.sep}`)) {
      await rm(resolvedTemporary, { recursive: true, force: true });
    }
  }
}

export async function loadPackFromDirectory(
  directory: string,
  schemaPath: string,
): Promise<PartnerPackManifestV1> {
  const result = await validatePackDirectory(directory, schemaPath);
  if (!result.ok || !result.manifest) {
    throw new Error(result.errors.join("\n"));
  }
  return result.manifest;
}

export async function loadBundledDemo(
  projectRoot: string,
): Promise<PartnerPackManifestV1> {
  const demoRoot = path.join(projectRoot, "examples", "demo-partner");
  const schemaPath = path.join(projectRoot, "schemas", "partner-pack.v1.schema.json");
  return loadPackFromDirectory(demoRoot, schemaPath);
}
