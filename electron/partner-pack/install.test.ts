import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { crc32, deflateRawSync } from "node:zlib";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installPackDirectory, installPackZip, validatePackDirectory } from "./service.js";
import { PACK_LIMITS } from "./validator.js";
import { XingbanDatabase } from "../storage/database.js";

const schema = path.join(process.cwd(), "schemas/partner-pack.v1.schema.json");
const demo = path.join(process.cwd(), "examples/demo-partner");
type ZipEntry = { name: string; data: Buffer; attributes?: number; size?: number; flags?: number; crc?: number };

// Tiny synthetic ZIP writer lets tests corrupt metadata without an external archive tool.
function archive(entries: ZipEntry[], deflate = true): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name);
    const data = deflate ? deflateRawSync(entry.data) : entry.data;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(entry.flags ?? 0x800, 6);
    header.writeUInt16LE(deflate ? 8 : 0, 8);
    header.writeUInt32LE(entry.crc ?? crc32(entry.data), 14);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.size ?? entry.data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const directory = Buffer.alloc(46);
    directory.writeUInt32LE(0x02014b50);
    directory.writeUInt16LE(0x314, 4);
    header.copy(directory, 6, 4, 28);
    directory.writeUInt32LE(entry.attributes ?? 0, 38);
    directory.writeUInt32LE(offset, 42);
    central.push(directory, name);
    offset += header.length + name.length + data.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}

let root: string;
let installRoot: string;
let zipPath: string;
let entries: ZipEntry[];
const defaultLimits = { ...PACK_LIMITS };

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "xingban-n2-test-"));
  installRoot = path.join(root, "partners");
  zipPath = path.join(root, "pack.zip");
  const manifestData = await readFile(path.join(demo, "manifest.json"));
  const manifest = JSON.parse(manifestData.toString());
  entries = [{ name: "manifest.json", data: manifestData }];
  for (const file of manifest.files) entries.push({ name: file.path, data: await readFile(path.join(demo, file.path)) });
});
afterEach(async () => {
  Object.assign(PACK_LIMITS, defaultLimits);
  vi.restoreAllMocks();
  if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith("xingban-n2-test-")) {
    throw new Error("TEST_CLEANUP_UNSAFE");
  }
  await rm(root, { recursive: true, force: true });
});

async function install(candidate = entries, options: Parameters<typeof installPackZip>[3] = {}) {
  await writeFile(zipPath, archive(candidate));
  return installPackZip(zipPath, installRoot, schema, options);
}
async function expectNoInstall() {
  expect(await readdir(installRoot).catch(() => [])).toEqual([]);
}

describe("N2 ZIP install", () => {
  it.each([true, false])("installs original media (deflate=%s), registers SQLite and survives reopen", async (deflate) => {
    await writeFile(zipPath, archive(entries, deflate));
    const dbPath = path.join(root, "test.sqlite3");
    const db = new XingbanDatabase(dbPath);
    const result = await installPackZip(zipPath, installRoot, schema, {
      register: ({ manifest, installedPath }) => db.saveInstalledPack({
        ...manifest, installPath: installedPath, manifestHash: "", enabled: true, installedAt: new Date().toISOString(),
      }),
    });
    db.close();
    expect(result.ok, result.errors.join(",")).toBe(true);
    expect((await validatePackDirectory(result.installedPath!, schema)).ok).toBe(true);
    const reopened = new XingbanDatabase(dbPath);
    try { expect(reopened.listInstalledPacks()[0].installPath).toBe(result.installedPath); }
    finally { reopened.close(); }
    expect((await readdir(installRoot)).some((name) => name.startsWith(".install-"))).toBe(false);
  });

  it.each(["../escape.webp", "/outside.webp", "C:/outside.webp", "assets\\escape.webp",
    "assets/CON.webp", "assets/cover./x.webp", "assets/x.webp:stream", "assets/x\u0000.webp",
    "assets/x.js", "README.md", "assets/" + "a/".repeat(17) + "x.webp"])("rejects unsafe path %s", async (name) => {
    expect((await install([...entries, { name, data: Buffer.from("bad") }])).ok).toBe(false);
    await expectNoInstall();
    expect(await readdir(root)).toEqual(expect.not.arrayContaining(["escape.webp", "outside.webp"]));
  });

  it.each([0xa000, 0x1000, 0x2000, 0x6000])("rejects symlink or special Unix type %s before writing", async (mode) => {
    expect((await install([{ name: "assets/link.webp", data: Buffer.from("../outside"), attributes: (mode << 16) >>> 0 }])).ok).toBe(false);
    await expectNoInstall();
  });
  it.each([0x400, 0x40])("rejects DOS reparse/device attribute %s", async (attributes) => {
    expect((await install([{ ...entries[1], attributes }])).ok).toBe(false);
    await expectNoInstall();
  });
  it.each(["manifest.json", "MANIFEST.JSON", "assets/cover/quiet-observatory.webp"])("rejects duplicate or case alias %s", async (name) => {
    expect((await install([...entries, { name, data: Buffer.from("duplicate") }])).ok).toBe(false);
    await expectNoInstall();
  });
  it("rejects case aliases between implicit parent directories", async () => {
    expect((await install([...entries, { name: "assets/Cover/extra.webp", data: entries[1].data }])).ok).toBe(false);
    await expectNoInstall();
  });
  it.each(["schema", "hash", "missing", "undeclared", "crc", "truncated", "encrypted", "size"])("rolls back %s failure", async (kind) => {
    if (kind === "schema") entries[0].data = Buffer.from('{"schemaVersion":1}');
    if (kind === "hash") entries[1].data = Buffer.alloc(entries[1].data.length);
    if (kind === "missing") entries.pop();
    if (kind === "undeclared") entries.push({ name: "assets/extra.webp", data: entries[1].data });
    if (kind === "crc") entries[0].crc = 0;
    if (kind === "encrypted") entries[0].flags = 1;
    if (kind === "size") entries[0].size = 1;
    await writeFile(zipPath, kind === "truncated" ? archive(entries).subarray(0, 40) : archive(entries));
    const register = vi.fn();
    expect((await installPackZip(zipPath, installRoot, schema, { register })).ok).toBe(false);
    expect(register).not.toHaveBeenCalled();
    await expectNoInstall();
  });
  it.each(["archiveBytes", "manifestBytes", "fileBytes", "totalBytes", "entries"] as const)("enforces %s", async (limit) => {
    Object.assign(PACK_LIMITS, { [limit]: 1 });
    expect((await install()).ok).toBe(false);
    await expectNoInstall();
  });
  it("rejects advertised expansion before inflation", async () => {
    entries[1].size = PACK_LIMITS.fileBytes + 1;
    expect((await install()).errors).toContain("PACK_SIZE_LIMIT");
    await expectNoInstall();
  });
  it("keeps an existing version byte-for-byte on conflict or failed upgrade, and permits retry", async () => {
    const first = await install();
    expect(first.ok).toBe(true);
    const oldManifest = await readFile(path.join(first.installedPath!, "manifest.json"));
    expect((await install()).errors).toContain("PACK_VERSION_CONFLICT");
    const next = JSON.parse(entries[0].data.toString());
    next.packVersion = "1.0.1";
    entries[0].data = Buffer.from(JSON.stringify(next));
    const failed = await install(entries, { register: () => { throw new Error("SQLITE_FAKE_FAILURE"); } });
    expect(failed.ok).toBe(false);
    expect(await readdir(path.dirname(first.installedPath!))).toEqual(["1.0.0"]);
    expect(await readFile(path.join(first.installedPath!, "manifest.json"))).toEqual(oldManifest);
    expect((await install()).ok).toBe(true);
  });
  it("serializes installs and releases its guard after cancellation", async () => {
    await writeFile(zipPath, archive(entries));
    const first = installPackZip(zipPath, installRoot, schema);
    expect((await installPackZip(zipPath, installRoot, schema)).errors).toContain("PACK_INSTALL_BUSY");
    expect((await first).ok).toBe(true);
    const controller = new AbortController();
    controller.abort();
    expect((await install(entries, { signal: controller.signal })).errors).toContain("PACK_INSTALL_CANCELLED");
  });
  it("aborts in-flight extraction, cleans staging and permits retry", async () => {
    const controller = new AbortController();
    await writeFile(zipPath, archive(entries));
    const running = installPackZip(zipPath, installRoot, schema, { signal: controller.signal });
    const timer = setTimeout(() => controller.abort(), 5);
    const result = await running;
    clearTimeout(timer);
    expect(result.errors).toContain("PACK_INSTALL_CANCELLED");
    await expectNoInstall();
    expect((await install()).ok).toBe(true);
  });
  it("times out without retaining partial output", async () => {
    Object.assign(PACK_LIMITS, { timeoutMs: 1 });
    expect((await install()).errors).toContain("PACK_INSTALL_TIMEOUT");
    await expectNoInstall();
  });
  it("refuses a linked destination parent without writing outside the install root", async () => {
    await mkdir(installRoot);
    const outside = path.join(root, "outside");
    await mkdir(outside);
    const id = JSON.parse(entries[0].data.toString()).partnerId;
    await symlink(outside, path.join(installRoot, id), "junction");
    expect((await install()).ok).toBe(false);
    expect(await readdir(outside)).toEqual([]);
  });
});

describe("directory import uses the same closed content boundary", () => {
  it("still installs the original demo directory", async () => {
    expect((await installPackDirectory(demo, installRoot, schema)).ok).toBe(true);
  });
  it.each(["root-script", "root-link", "assets-link"])("rejects %s and leaves source untouched", async (kind) => {
    const source = path.join(root, "source");
    await cp(demo, source, { recursive: true });
    if (kind === "root-script") await writeFile(path.join(source, "run.js"), "throw 1");
    if (kind === "root-link") await symlink(demo, path.join(source, "linked"), "junction");
    if (kind === "assets-link") {
      await rm(path.join(source, "assets"), { recursive: true });
      await symlink(path.join(demo, "assets"), path.join(source, "assets"), "junction");
    }
    expect((await installPackDirectory(source, installRoot, schema)).ok).toBe(false);
    expect((await lstat(source)).isDirectory()).toBe(true);
    await expectNoInstall();
  });
});
