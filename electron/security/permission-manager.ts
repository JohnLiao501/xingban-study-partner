/**
 * 安全权限管理器
 *
 * 彻底收紧 Electron 媒体与系统权限：
 * - 默认拒绝所有权限请求；
 * - 摄像头 (camera/video-capture)、麦克风 (microphone/audio-capture) 始终无条件拒绝；
 * - 仅在一次性授权 token 存在且未过期时，对专用隐藏截图窗口放行显示捕获检查；
 * - 真正的授权只由主进程 display-media handler 消费，并强制绑定已选择的 sourceId。
 */

import { randomUUID } from "node:crypto";

export interface PermissionManagerOptions {
  /** 一次性授权有效期（毫秒），默认 10000ms */
  tokenTtlMs?: number;
}

export interface CaptureAuthContext {
  token: string;
  sourceId: string;
  issuedAt: number;
  expiresAt: number;
}

export class PermissionManager {
  private captureWebContentsId: number | null = null;
  private activeAuthContext: CaptureAuthContext | null = null;
  private readonly tokenTtlMs: number;

  constructor(options: PermissionManagerOptions = {}) {
    this.tokenTtlMs = options.tokenTtlMs ?? 10000;
  }

  /** 注册专用截图窗口的 webContentsId */
  setCaptureWebContentsId(id: number | null): void {
    this.captureWebContentsId = id;
  }

  /** 获取当前登记的截图窗口 id */
  getCaptureWebContentsId(): number | null {
    return this.captureWebContentsId;
  }

  /** 生成一次性屏幕捕获授权上下文 */
  issueCaptureAuth(sourceId: string): CaptureAuthContext {
    const now = Date.now();
    const token = randomUUID();
    const context: CaptureAuthContext = {
      token,
      sourceId,
      issuedAt: now,
      expiresAt: now + this.tokenTtlMs,
    };
    this.activeAuthContext = context;
    return context;
  }

  /** 取消或重置捕获授权 */
  revokeCaptureAuth(): void {
    this.activeAuthContext = null;
  }

  /** 检查当前是否存在有效捕获授权（不作废） */
  hasActiveCaptureAuth(): boolean {
    if (!this.activeAuthContext) return false;
    if (Date.now() > this.activeAuthContext.expiresAt) {
      this.activeAuthContext = null;
      return false;
    }
    return true;
  }

  /**
   * 由主进程 display-media handler 消费一次性授权。
   * 只有专用截图窗口可以取得上下文，读取后立即作废。
   */
  consumeCaptureAuth(requesterWebContentsId: number): CaptureAuthContext | null {
    if (this.captureWebContentsId === null || requesterWebContentsId !== this.captureWebContentsId) {
      return null;
    }
    if (!this.hasActiveCaptureAuth()) return null;
    const context = this.activeAuthContext;
    this.activeAuthContext = null;
    return context;
  }

  /**
   * 判定权限请求是否允许（纯函数逻辑，供 Electron permissionRequestHandler 调用）
   *
   * @param requesterWebContentsId 发起请求的 webContents id
   * @param permission 请求的权限类型
   * @param details 额外请求详情（如 mediaType）
   */
  shouldAllowPermission(
    requesterWebContentsId: number,
    permission: string,
    details?: { mediaTypes?: string[] },
  ): boolean {
    // 摄像头和麦克风一律无条件拒绝
    if (
      permission === "camera" ||
      permission === "microphone" ||
      permission === "media" ||
      permission === "clipboard-read" ||
      permission === "notifications" ||
      permission === "geolocation"
    ) {
      return false;
    }

    if (details?.mediaTypes) {
      if (details.mediaTypes.includes("audio")) return false;
    }

    // 仅允许专用截图窗口
    if (
      this.captureWebContentsId === null ||
      requesterWebContentsId !== this.captureWebContentsId
    ) {
      return false;
    }

    // Electron 44 的显示捕获使用独立 display-capture 权限；普通 media
    // 可能代表摄像头或麦克风，已在上方无条件拒绝。
    const isDisplayCapture = permission === "display-capture";

    if (!isDisplayCapture) {
      return false;
    }

    // 权限检查阶段不消费 token；实际 source 选择由 display-media handler 完成。
    if (!this.hasActiveCaptureAuth()) {
      return false;
    }
    return true;
  }
}
