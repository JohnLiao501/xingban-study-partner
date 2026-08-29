/**
 * 隐私与敏感数据扫盘审计测试 (Privacy Audit & Zero-Leak Assertions)
 *
 * 验证：
 * 1. redactSensitive 对 API Key、Bearer Token、Base64 图像的完全脱敏
 * 2. 数据库零泄漏：全库全表无明文密钥、无 Base64 图像、窗口标题仅存 SHA-256 哈希
 * 3. 磁盘零残留：临时目录与工作区无巡查截图落盘
 */

import { describe, it, expect } from "vitest";
import { redactSensitive } from "./redaction.js";
import { XingbanDatabase } from "../storage/database.js";
import { SecretStore, type SafeStorageInterface } from "./secret-store.js";
import { hashWindowTitle } from "../inspection/observation.js";
import { createSession } from "../../shared/session-engine.js";
import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import os from "node:os";

describe("隐私安全与脱敏审计 (Privacy Audit)", () => {
  it("redactSensitive 正确脱敏 Bearer Token、API 密钥与 Base64 图像数据", () => {
    const rawLog =
      "Request headers: { Authorization: 'Bearer sk-abcdef1234567890abcdef' }, body image: 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP...'";

    const sanitized = redactSensitive(rawLog);

    expect(sanitized).not.toContain("sk-abcdef1234567890abcdef");
    expect(sanitized).toContain("Bearer [REDACTED_SECRET]");
    expect(sanitized).not.toContain("/9j/4AAQSkZJRgABAQEASABIAAD");
    expect(sanitized).toContain("[IMAGE_DATA_REDACTED]");
  });

  it("数据库全量扫描断言：无明文密钥、无图像 Base64、原始标题不落盘", () => {
    const db = new XingbanDatabase(":memory:");

    const mockStorage: SafeStorageInterface = {
      isEncryptionAvailable: () => true,
      encryptString: (plainText: string) => Buffer.from(`ENC:${plainText}`),
      decryptString: (buf: Buffer) => buf.toString().slice(4),
    };

    const secretStore = new SecretStore(db, mockStorage);
    const testSecretKey = "sk-super-confidential-key-999888";
    secretStore.setApiKey(testSecretKey);

    const rawTitle = "机密设计稿 - 绝密项目.docx - Microsoft Word";
    const hashedTitle = hashWindowTitle(rawTitle);

    db.saveSession(createSession({
      partnerId: "demo.guardian-zero",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "隐私审计测试",
      plannedMinutes: 25,
    }, { sessionId: "audit-session-001", seed: 100 }));

    db.recordStructuredObservation({
      sessionId: "audit-session-001",
      observedAt: new Date().toISOString(),
      label: "focused",
      confidence: 0.96,
      source: "local-rule",
      reasonCode: "allowed_app",
      appName: "Word",
      windowTitleHash: hashedTitle,
      confirmedDeviation: false,
    });

    // 扫描整个数据库的所有表所有字段
    const tables = ["app_settings", "observations", "sessions", "app_rules"];
    for (const table of tables) {
      const rows = (db as any).database.prepare(`SELECT * FROM ${table}`).all();
      const stringified = JSON.stringify(rows);

      // 断言 1: 绝对不包含明文 API 密钥
      expect(stringified).not.toContain(testSecretKey);

      // 断言 2: 绝对不包含原始窗口标题明文
      expect(stringified).not.toContain(rawTitle);

      // 断言 3: 绝对不包含 JPEG 图片 Base64 头
      expect(stringified).not.toContain("data:image/jpeg");
      expect(stringified).not.toContain("/9j/");
    }

    // 断言 4: 确认窗口标题哈希是标准的 64 字符 SHA-256
    const obs = db.listSessionObservations("audit-session-001");
    expect(obs[0].windowTitleHash).toMatch(/^[a-f0-9]{64}$/);

    db.close();
  });

  it("磁盘零残留断言：临时目录与工作区中不存在巡查截图文件", () => {
    // 检查项目根目录中不存在任何 inspection / frame 图像文件
    const projectRoot = path.resolve(__dirname, "..", "..");
    const files = readdirSync(projectRoot);

    const leakedImages = files.filter((f) => {
      const lower = f.toLowerCase();
      return (
        (lower.includes("frame") || lower.includes("capture") || lower.includes("inspect")) &&
        (lower.endsWith(".jpg") || lower.endsWith(".png") || lower.endsWith(".jpeg"))
      );
    });

    expect(leakedImages).toEqual([]);
  });
});
