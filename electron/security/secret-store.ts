/**
 * API 密钥安全存储 (SecretStore)
 *
 * 规范：
 * - 必须使用 Electron safeStorage 进行操作系统级凭据加密存储；
 * - 若 safeStorage 不可用，必须报错拦截，严禁明文存盘；
 * - 密钥绝不返回给 renderer，仅供主进程多模态适配器内部读取；
 * - 支持清空密钥。
 */

import { safeStorage } from "electron";
import type { XingbanDatabase } from "../storage/database.js";

const SETTINGS_KEY_ENCRYPTED_API_KEY = "vision_api_key_encrypted";

export interface SafeStorageInterface {
  isEncryptionAvailable: () => boolean;
  encryptString: (plainText: string) => Buffer;
  decryptString: (encrypted: Buffer) => string;
}

export class SafeStorageUnavailableError extends Error {
  constructor(message = "SAFE_STORAGE_UNAVAILABLE") {
    super(message);
    this.name = "SafeStorageUnavailableError";
  }
}

export class SecretStore {
  private readonly storage: SafeStorageInterface;

  constructor(
    private readonly database: XingbanDatabase,
    customStorage?: SafeStorageInterface,
  ) {
    this.storage = customStorage ?? safeStorage;
  }

  /** 判断当前操作系统环境是否支持 safeStorage 加密 */
  isAvailable(): boolean {
    try {
      return this.storage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  /**
   * 加密保存 API 密钥
   *
   * @throws SafeStorageUnavailableError 当加密不可用时抛出，绝不明文存储
   */
  setApiKey(apiKey: string): void {
    const trimmed = apiKey.trim();
    if (!trimmed) {
      this.clearApiKey();
      return;
    }

    if (!this.isAvailable()) {
      throw new SafeStorageUnavailableError("当前操作系统安全存储服务不可用，无法安全存储密钥");
    }

    const encryptedBuffer = this.storage.encryptString(trimmed);
    const base64Encrypted = encryptedBuffer.toString("base64");
    this.database.setAppSetting(SETTINGS_KEY_ENCRYPTED_API_KEY, base64Encrypted);
  }

  /**
   * 读取并解密 API 密钥，仅在主进程内部调用，绝不返回给渲染进程
   */
  getApiKey(): string | null {
    const raw = this.database.getAppSetting(SETTINGS_KEY_ENCRYPTED_API_KEY);
    if (!raw) return null;

    if (!this.isAvailable()) {
      return null;
    }

    try {
      const buffer = Buffer.from(raw, "base64");
      return this.storage.decryptString(buffer);
    } catch {
      return null;
    }
  }

  /** 判断当前是否已配置有效的 API 密钥 */
  hasApiKey(): boolean {
    const raw = this.database.getAppSetting(SETTINGS_KEY_ENCRYPTED_API_KEY);
    return Boolean(raw && raw.length > 0);
  }

  /** 清除已保存的 API 密钥 */
  clearApiKey(): void {
    this.database.deleteAppSetting(SETTINGS_KEY_ENCRYPTED_API_KEY);
  }
}
