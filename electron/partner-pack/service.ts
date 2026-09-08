import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, rename, rm, rmdir } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type {
  PartnerPackManifestV1,
  PackValidationResult,
} from "../../shared/partner-pack.js";
import { isAllowedPackEntry, isSafePackPath, PACK_LIMITS, validatePartnerManifest } from "./validator.js";
import { extractPackZip } from "./zip.js";

const APP_VERSION = "0.1.0";

export function resolvePackAssetPath(root: string, relativePath: string): string {
  if (!isSafePackPath(relativePath)) throw new Error(`PACK_PATH_UNSAFE ${relativePath}`);
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(root, ...relativePath.split("/"));
  if (!resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`PACK_PATH_UNSAFE ${relativePath}`);
  }
  return resolvedPath;
}

async function sha256(filePath: string, signal?: AbortSignal): Promise<string> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.readableWebStream()) {
      signal?.throwIfAborted();
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

async function listPackFiles(root: string, signal?: AbortSignal): Promise<string[]> {
  const files: string[] = [];
  const seen = new Set<string>();
  let count = 0;
  let total = 0;
  async function walk(directory: string): Promise<void> {
    signal?.throwIfAborted();
    const entries = await readdir(path.join(root, directory), { withFileTypes: true });
    for (const entry of entries) {
      if (++count > PACK_LIMITS.entries) throw new Error("PACK_ENTRY_LIMIT");
      const relativePath = directory ? `${directory}/${entry.name}` : entry.name;
      if (!isAllowedPackEntry(relativePath, entry.isDirectory())) throw new Error("PACK_PATH_UNSAFE");
      const key = relativePath.toLowerCase();
      if (seen.has(key)) throw new Error("PACK_DUPLICATE_PATH");
      seen.add(key);
      const fileStat = await lstat(resolvePackAssetPath(root, relativePath));
      if (fileStat.isSymbolicLink()) throw new Error("PACK_SYMLINK_FORBIDDEN");
      if (fileStat.isDirectory()) {
        await walk(relativePath);
      } else if (fileStat.isFile()) {
        const limit = relativePath === "manifest.json" ? PACK_LIMITS.manifestBytes : PACK_LIMITS.fileBytes;
        if (fileStat.size > limit || (total += fileStat.size) > PACK_LIMITS.totalBytes) {
          throw new Error("PACK_SIZE_LIMIT");
        }
        files.push(relativePath);
      } else throw new Error("PACK_FILE_NOT_REGULAR");
    }
  }
  const rootStat = await lstat(root);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error("PACK_SYMLINK_FORBIDDEN");
  await walk("");
  return files;
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

export async function validatePackDirectory(
  root: string,
  schemaPath: string,
  currentAppVersion = APP_VERSION,
  signal?: AbortSignal,
): Promise<PackValidationResult> {
  try {
    const actualFiles = await listPackFiles(root, signal);
    const schema = await readJson(schemaPath);
    const candidate = await readJson(path.join(root, "manifest.json"));
    const manifestResult = validatePartnerManifest(schema as object, candidate, currentAppVersion);
    if (!manifestResult.ok || !manifestResult.manifest) return manifestResult;

    const manifest = manifestResult.manifest;
    const errors: string[] = [];
    const declaredPaths = new Set(manifest.files.map((file) => file.path));
    const actualPaths = new Set(actualFiles.filter((file) => file !== "manifest.json"));

    for (const file of manifest.files) {
      const absolutePath = resolvePackAssetPath(root, file.path);
      try {
        const fileStat = await lstat(absolutePath);
        if (!fileStat.isFile()) {
          errors.push(`PACK_FILE_NOT_REGULAR ${file.path}`);
          continue;
        }
        if (fileStat.size !== file.sizeBytes) {
          errors.push(`PACK_FILE_SIZE_MISMATCH ${file.path}`);
        }
        if (await sha256(absolutePath, signal) !== file.sha256) {
          errors.push(`PACK_FILE_HASH_MISMATCH ${file.path}`);
        }
        if (!await verifyMediaSignature(absolutePath, path.extname(file.path).toLowerCase())) {
          errors.push(`PACK_MEDIA_SIGNATURE_INVALID ${file.path}`);
        }
      } catch (error) {
        signal?.throwIfAborted();
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
      errors: [packErrorCode(error, signal)],
    };
  }
}

export function packErrorCode(error: unknown, signal?: AbortSignal): string {
  if (signal?.aborted) return signal.reason?.name === "TimeoutError" ? "PACK_INSTALL_TIMEOUT" : "PACK_INSTALL_CANCELLED";
  return error instanceof Error && /^PACK_[A-Z_]+$/.test(error.message)
    ? error.message : "PACK_INSTALL_FAILED";
}

export type InstalledPack = { manifest: PartnerPackManifestV1; installedPath: string };
type InstallOptions = {
  signal?: AbortSignal;
  // Synchronous SQLite commit: a failure removes only the newly published version.
  register?: (pack: InstalledPack) => void;
};
// ponytail: one local app serializes imports; separate queues only if multiple libraries are needed.
let installing = false;

export async function installPackDirectory(
  sourceRoot: string,
  installRoot: string,
  schemaPath: string,
  options: InstallOptions = {},
): Promise<PackValidationResult & { installedPath?: string }> {
  return installPack(sourceRoot, installRoot, schemaPath, false, options);
}

export async function installPackZip(source: string, installRoot: string, schemaPath: string, options: InstallOptions = {}) {
  return installPack(source, installRoot, schemaPath, true, options);
}

async function installPack(source: string, root: string, schemaPath: string, zip: boolean, options: InstallOptions) {
  if (installing) return { ok: false, errors: ["PACK_INSTALL_BUSY"] };
  installing = true;
  const signal = AbortSignal.any([AbortSignal.timeout(PACK_LIMITS.timeoutMs), ...(options.signal ? [options.signal] : [])]);
  const installRoot = path.resolve(root);
  let temporary: string | undefined;
  let published: string | undefined;
  let partnerRoot: string | undefined;
  let createdPartnerRoot = false;
  try {
    signal.throwIfAborted();
    await mkdir(installRoot, { recursive: true });
    const rootStat = await lstat(installRoot);
    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error("PACK_PATH_UNSAFE");
    temporary = await mkdtemp(path.join(installRoot, ".install-"));
    if (zip) {
      await extractPackZip(source, temporary, signal);
    } else {
      const validation = await validatePackDirectory(source, schemaPath, APP_VERSION, signal);
      if (!validation.ok || !validation.manifest) return validation;
      for (const name of ["manifest.json", ...validation.manifest.files.map((file) => file.path)]) {
        signal.throwIfAborted();
        const inputPath = resolvePackAssetPath(source, name);
        const sourceStat = await lstat(inputPath);
        if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("PACK_FILE_NOT_REGULAR");
        const target = resolvePackAssetPath(temporary, name);
        await mkdir(path.dirname(target), { recursive: true });
        const handle = await open(inputPath, "r");
        try {
          let size = 0;
          await pipeline(handle.createReadStream({ autoClose: false }), new Transform({
            transform(chunk: Buffer, _encoding, callback) {
              size += chunk.length;
              callback(size > sourceStat.size ? new Error("PACK_SIZE_LIMIT") : null, chunk);
            },
          }), createWriteStream(target, { flags: "wx" }), { signal });
        } finally { await handle.close(); }
      }
    }
    const copiedValidation = await validatePackDirectory(temporary, schemaPath, APP_VERSION, signal);
    if (!copiedValidation.ok || !copiedValidation.manifest) return copiedValidation;
    signal.throwIfAborted();
    const { partnerId, packVersion } = copiedValidation.manifest;
    partnerRoot = resolvePackAssetPath(installRoot, partnerId);
    createdPartnerRoot = (await mkdir(partnerRoot, { recursive: true })) !== undefined;
    const partnerStat = await lstat(partnerRoot);
    if (partnerStat.isSymbolicLink() || !partnerStat.isDirectory()) throw new Error("PACK_PATH_UNSAFE");
    const destination = resolvePackAssetPath(partnerRoot, packVersion);
    const existing = await lstat(destination).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing) throw new Error("PACK_VERSION_CONFLICT");
    // ponytail: rename and SQLite are not a crash-atomic transaction; an orphan version stays a conflict.
    await rename(temporary, destination);
    published = destination;
    signal.throwIfAborted();
    options.register?.({ manifest: copiedValidation.manifest, installedPath: destination });
    published = undefined;
    return {
      ok: true,
      manifest: copiedValidation.manifest,
      errors: [],
      installedPath: destination,
    };
  } catch (error) {
    return { ok: false, errors: [packErrorCode(error, signal)] };
  } finally {
    try {
      for (const owned of [published, temporary]) {
        if (owned && path.resolve(owned).startsWith(`${installRoot}${path.sep}`)) {
          await rm(owned, { recursive: true, force: true });
        }
      }
      // Only remove an empty parent created by a failed first installation.
      if (partnerRoot && createdPartnerRoot) await rmdir(partnerRoot).catch(() => {});
    } finally {
      installing = false;
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

export interface DiscoveredPack {
  manifest: PartnerPackManifestV1;
  directoryPath: string;
}

export async function discoverLocalPacks(
  searchDirectory: string,
  schemaPath: string,
): Promise<DiscoveredPack[]> {
  try {
    const entries = await readdir(searchDirectory, { withFileTypes: true });
    const discovered: DiscoveredPack[] = [];
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const candidateDir = path.join(searchDirectory, entry.name);
        try {
          const result = await validatePackDirectory(candidateDir, schemaPath);
          if (result.ok && result.manifest) {
            discovered.push({
              manifest: result.manifest,
              directoryPath: candidateDir,
            });
          }
        } catch {
          // 忽略校验失败或非伙伴包目录
        }
      }
    }
    return discovered;
  } catch {
    return [];
  }
}
