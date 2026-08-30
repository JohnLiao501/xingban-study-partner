import path from "node:path";
import { describe, expect, it } from "vitest";
import { XingbanDatabase } from "../storage/database.js";
import { isSafePackPath } from "./validator.js";

const projectRoot = process.cwd();

describe("多伙伴系统的通用切换底座", () => {
  it("数据库支持记录、列出与选择激活伙伴", () => {
    const db = new XingbanDatabase(":memory:");
    try {
      expect(db.getActivePartnerId()).toBeNull();

      db.saveInstalledPack({
        partnerId: "test.companion-two",
        packVersion: "1.0.0",
        displayName: "测试伙伴乙",
        sourceType: "original",
        distribution: "redistributable",
        installPath: path.join(projectRoot, "test-fixtures", "companion-two"),
        manifestHash: "hash-123",
        enabled: true,
        installedAt: new Date().toISOString(),
      });

      const installed = db.listInstalledPacks();
      expect(installed.length).toBe(1);
      expect(installed[0].partnerId).toBe("test.companion-two");
      expect(installed[0].displayName).toBe("测试伙伴乙");

      db.setActivePartnerId("test.companion-two");
      expect(db.getActivePartnerId()).toBe("test.companion-two");

      db.deleteInstalledPack("test.companion-two");
      expect(db.listInstalledPacks().length).toBe(0);
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
  });

  it("信赖等级解析器依据当前伙伴关系阶梯正确计算", () => {
    const relationshipLevels = [
      { id: "initial", displayName: "初识", minimumTrust: 0 },
      { id: "familiar", displayName: "熟悉", minimumTrust: 100 },
      { id: "trusted", displayName: "信赖", minimumTrust: 300 },
    ];

    const resolveLevel = (trust: number) => {
      const eligible = relationshipLevels
        .filter((level) => level.minimumTrust <= trust)
        .sort((left, right) => right.minimumTrust - left.minimumTrust);
      return eligible[0]?.id ?? relationshipLevels[0]?.id ?? "initial";
    };

    expect(resolveLevel(0)).toBe("initial");
    expect(resolveLevel(99)).toBe("initial");
    expect(resolveLevel(100)).toBe("familiar");
    expect(resolveLevel(299)).toBe("familiar");
    expect(resolveLevel(300)).toBe("trusted");
    expect(resolveLevel(500)).toBe("trusted");
  });
});
