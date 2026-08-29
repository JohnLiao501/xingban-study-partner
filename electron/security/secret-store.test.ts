/**
 * SecretStore 单元测试
 *
 * 验证：
 * - safeStorage 加密保存与解密还原
 * - 密码清除与状态变更
 * - safeStorage 不可用时严禁明文入库并抛出明确错误
 * - 畸形数据解密容错
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SecretStore, SafeStorageUnavailableError, type SafeStorageInterface } from "./secret-store.js";
import { XingbanDatabase } from "../storage/database.js";

describe("SecretStore", () => {
  let db: XingbanDatabase;

  // 模拟一个简单可逆的 safeStorage 测试实现
  const mockStorage: SafeStorageInterface = {
    isEncryptionAvailable: () => true,
    encryptString: (plainText: string) => Buffer.from(`ENC:${plainText}`, "utf8"),
    decryptString: (encrypted: Buffer) => {
      const str = encrypted.toString("utf8");
      if (!str.startsWith("ENC:")) throw new Error("DECRYPT_FAILED");
      return str.slice(4);
    },
  };

  beforeEach(() => {
    db = new XingbanDatabase(":memory:");
  });

  it("正常加密保存并能正确解密读取", () => {
    const store = new SecretStore(db, mockStorage);
    expect(store.hasApiKey()).toBe(false);
    expect(store.getApiKey()).toBeNull();

    store.setApiKey("sk-secret-key-123456");
    expect(store.hasApiKey()).toBe(true);
    expect(store.getApiKey()).toBe("sk-secret-key-123456");

    // 检查数据库底层存储的是 Base64 密文，绝非明文！
    const rawInDb = db.getAppSetting("vision_api_key_encrypted");
    expect(rawInDb).toBeTruthy();
    expect(rawInDb).not.toContain("sk-secret-key-123456");
  });

  it("清除密钥后状态重置为无密钥", () => {
    const store = new SecretStore(db, mockStorage);
    store.setApiKey("sk-sample");
    expect(store.hasApiKey()).toBe(true);

    store.clearApiKey();
    expect(store.hasApiKey()).toBe(false);
    expect(store.getApiKey()).toBeNull();
  });

  it("safeStorage 不可用时拒绝保存并抛出异常，绝不发生明文泄露", () => {
    const disabledStorage: SafeStorageInterface = {
      isEncryptionAvailable: () => false,
      encryptString: () => Buffer.from(""),
      decryptString: () => "",
    };

    const store = new SecretStore(db, disabledStorage);
    expect(store.isAvailable()).toBe(false);

    expect(() => {
      store.setApiKey("sk-confidential");
    }).toThrow(SafeStorageUnavailableError);

    // 数据库中不应有任何写入
    expect(db.getAppSetting("vision_api_key_encrypted")).toBeNull();
  });

  it("解密异常时安全返回 null，不发生应用崩溃", () => {
    const store = new SecretStore(db, mockStorage);
    // 直接在数据库中灌入损坏的 Base64
    db.setAppSetting("vision_api_key_encrypted", Buffer.from("CORRUPT_PAYLOAD").toString("base64"));

    expect(store.hasApiKey()).toBe(true);
    expect(store.getApiKey()).toBeNull();
  });
});
