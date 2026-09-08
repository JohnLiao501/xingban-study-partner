import { createWriteStream } from "node:fs";
import { lstat, mkdir } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { crc32 } from "node:zlib";
import { openPromise } from "yauzl";
import { isAllowedPackEntry, PACK_LIMITS } from "./validator.js";

// The caller owns a newly created, private staging directory, never an installed pack.
export async function extractPackZip(source: string, staging: string, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  const sourceStat = await lstat(source);
  if (!sourceStat.isFile() || sourceStat.isSymbolicLink()) throw new Error("PACK_FILE_NOT_REGULAR");
  if (sourceStat.size > PACK_LIMITS.archiveBytes) throw new Error("PACK_ARCHIVE_LIMIT");
  const zip = await openPromise(source, {
    lazyEntries: true, strictFileNames: true, validateEntrySizes: true, autoClose: false,
  });
  try {
    signal.throwIfAborted();
    if (zip.fileSize > PACK_LIMITS.archiveBytes) throw new Error("PACK_ARCHIVE_LIMIT");
    if (zip.entryCount > PACK_LIMITS.entries) throw new Error("PACK_ENTRY_LIMIT");
    const paths = new Set<string>();
    const spelling = new Map<string, string>();
    let total = 0;
    let count = 0;
    for await (const entry of zip.eachEntry()) {
      signal.throwIfAborted();
      if (++count > PACK_LIMITS.entries) throw new Error("PACK_ENTRY_LIMIT");
      const directory = entry.fileName.endsWith("/");
      const name = directory ? entry.fileName.slice(0, -1) : entry.fileName;
      if (!isAllowedPackEntry(name, directory)) throw new Error("PACK_PATH_UNSAFE");
      const key = name.toLowerCase();
      if (paths.has(key)) throw new Error("PACK_DUPLICATE_PATH");
      paths.add(key);
      const segments = name.split("/");
      for (let index = 1; index <= segments.length; index++) {
        const prefix = segments.slice(0, index).join("/");
        const existing = spelling.get(prefix.toLowerCase());
        if (existing && existing !== prefix) throw new Error("PACK_DUPLICATE_PATH");
        spelling.set(prefix.toLowerCase(), prefix);
      }
      const type = (entry.externalFileAttributes >>> 16) & 0xf000;
      if (type !== 0 && type !== (directory ? 0x4000 : 0x8000)) {
        throw new Error("PACK_FILE_NOT_REGULAR");
      }
      // DOS reparse/device attributes and encryption are never pack content.
      if ((entry.externalFileAttributes & 0x440) || entry.isEncrypted() || !entry.canDecodeFileData()) {
        throw new Error("PACK_ZIP_UNSUPPORTED");
      }
      const limit = name === "manifest.json" ? PACK_LIMITS.manifestBytes : PACK_LIMITS.fileBytes;
      if (entry.uncompressedSize > limit || (total += entry.uncompressedSize) > PACK_LIMITS.totalBytes) {
        throw new Error("PACK_SIZE_LIMIT");
      }
      const target = path.join(staging, ...name.split("/"));
      if (directory) {
        if (entry.uncompressedSize !== 0) throw new Error("PACK_ZIP_INVALID");
        await mkdir(target, { recursive: true });
        continue;
      }
      await mkdir(path.dirname(target), { recursive: true });
      const input = await zip.openReadStreamPromise(entry);
      let actual = 0;
      let checksum = 0;
      await pipeline(input, new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          actual += chunk.length;
          if (actual > limit || actual > entry.uncompressedSize) {
            callback(new Error("PACK_SIZE_LIMIT"));
          } else {
            checksum = crc32(chunk, checksum);
            callback(null, chunk);
          }
        },
      }), createWriteStream(target, { flags: "wx" }), { signal });
      if (actual !== entry.uncompressedSize || checksum !== entry.crc32) throw new Error("PACK_ZIP_INVALID");
    }
  } finally {
    zip.close();
  }
}
