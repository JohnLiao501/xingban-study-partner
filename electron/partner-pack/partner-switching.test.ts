import path from "node:path";
import { describe, expect, it } from "vitest";
import { XingbanDatabase } from "../storage/database.js";
import { resolvePackAssetPath } from "./service.js";
import { isSafePackPath } from "./validator.js";

const projectRoot = process.cwd();

describe("多伙伴系统的通用切换底座", () => {
  it("数据库支持记录、列出与选择激活伙伴", () => {
    const db = new XingbanDatabase(":memory:");
    try {
      expect(db.getActivePartnerId()).toBeNull();

      const first = {
        partnerId: "fixture-observer",
        packVersion: "1.0.0",
        displayName: "观察者一号",
        sourceType: "original",
        distribution: "redistributable",
        installPath: path.join(projectRoot, "test-fixtures", "observer"),
        manifestHash: "hash-observer",
        enabled: true,
        installedAt: "2026-09-03T00:00:00.000Z",
      };
      const second = {
        ...first,
        partnerId: "fixture-navigator",
        displayName: "引航者一号",
        installPath: path.join(projectRoot, "test-fixtures", "navigator"),
        manifestHash: "hash-navigator",
        installedAt: "2026-09-03T00:01:00.000Z",
      };
      db.saveInstalledPack(first);
      db.saveInstalledPack(second);

      const installed = db.listInstalledPacks();
      expect(installed.map((partner) => partner.partnerId)).toEqual([
        "fixture-navigator",
        "fixture-observer",
      ]);

      db.setActivePartnerId("fixture-navigator");
      expect(db.getActivePartnerId()).toBe("fixture-navigator");

      db.deleteInstalledPack("fixture-navigator");
      expect(db.listInstalledPacks().map((partner) => partner.partnerId)).toEqual(["fixture-observer"]);
    } finally {
      db.close();
    }
  });

  it("partner-asset 路径安全守卫 isSafePackPath 拒绝任何跨目录行为", () => {
    expect(isSafePackPath("assets/cover/quiet-observatory.webp")).toBe(true);
    expect(isSafePackPath("assets/video/idle-loop.mp4")).toBe(true);
    expect(isSafePackPath("../outside.webp")).toBe(false);
    expect(isSafePackPath("/root/file.mp4")).toBe(false);
    expect(isSafePackPath("assets\\nested.mp4")).toBe(false);
    expect(isSafePackPath("C:/Windows/file.txt")).toBe(false);
    expect(resolvePackAssetPath(projectRoot, "assets/video/idle-loop.mp4"))
      .toBe(path.join(projectRoot, "assets", "video", "idle-loop.mp4"));
    expect(() => resolvePackAssetPath(projectRoot, "../outside.webp"))
      .toThrow("PACK_PATH_UNSAFE");
  });
});
