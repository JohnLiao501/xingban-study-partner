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
   * Electron 44 会把 getDisplayMedia 的前置检查报告为 media/video，而不是
   * display-capture。这里只为专用主 frame 的一次性授权放行检查；最终源选择仍由
   * display-media handler 消费 token 并强制绑定用户选择的 screen source。
   */
  shouldAllowPermissionCheck(
    requesterWebContentsId: number,
    permission: string,
    details?: { mediaType?: string; isMainFrame?: boolean },
  ): boolean {
    return this.isAuthorizedCaptureWindow(requesterWebContentsId) &&
      permission === "media" &&
      details?.mediaType === "video" &&
      details.isMainFrame === true &&
      this.hasActiveCaptureAuth();
  }

  /**
   * Electron 44/Windows 的权限请求实测会把 getDisplayMedia 报告为
   * media 且 mediaTypes 为空；同时兼容规范化的 display-capture。摄像头/麦克风
   * 请求会声明 video/audio 类型并被拒绝。最终仍必须经过 display-media handler。
   */
  shouldAllowPermissionRequest(
    requesterWebContentsId: number,
    permission: string,
    details?: { mediaTypes?: string[] },
  ): boolean {
    if (!this.isAuthorizedCaptureWindow(requesterWebContentsId)) return false;
    const mediaTypes = details?.mediaTypes ?? [];
    const isDisplayCapture = permission === "display-capture";
    const isWindowsDisplayMedia = permission === "media" && mediaTypes.length === 0;
    if (!isDisplayCapture && !isWindowsDisplayMedia) return false;
    if (mediaTypes.includes("audio")) return false;
    return this.hasActiveCaptureAuth();
  }

  private isAuthorizedCaptureWindow(requesterWebContentsId: number): boolean {
    return this.captureWebContentsId !== null &&
      requesterWebContentsId === this.captureWebContentsId;
  }
}
