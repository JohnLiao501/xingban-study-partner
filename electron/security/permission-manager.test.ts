/**
 * PermissionManager 单元测试
 *
 * 验证：
 * - 默认拒绝所有权限请求
 * - 摄像头、麦克风无条件拒绝
 * - 非 captureWebContents 拒绝
 * - 专用 captureWebContents 在单次有效授权下通过权限检查
 * - 显示媒体 handler 消费授权后立即作废（防重放）
 * - 授权 token 超时失效
 * - 主动 revoke 立即失效
 */

import { describe, it, expect } from "vitest";
import { PermissionManager } from "./permission-manager.js";

describe("PermissionManager", () => {
  it("默认拒绝一切未经授权的请求", () => {
    const pm = new PermissionManager();
    expect(pm.shouldAllowPermissionCheck(1, "media", { mediaType: "video", isMainFrame: true })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(1, "display-capture")).toBe(false);
  });

  it("权限请求阶段只接受 display-capture 或 Electron 44/Windows 的 media 空类型表示", () => {
    const pm = new PermissionManager();
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    expect(pm.shouldAllowPermissionRequest(42, "camera")).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "microphone")).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "media", { mediaTypes: [] })).toBe(true);
    expect(pm.shouldAllowPermissionRequest(42, "media", { mediaTypes: ["video"] })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "media", { mediaTypes: ["audio"] })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "media", { mediaTypes: ["video", "audio"] })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "media")).toBe(true);
  });

  it("非注册的 webContentsId 始终拒绝", () => {
    const pm = new PermissionManager();
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    // webContentsId 是 99，不是 42
    expect(pm.shouldAllowPermissionCheck(99, "media", { mediaType: "video", isMainFrame: true })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(99, "display-capture")).toBe(false);
  });

  it("Electron 44 的 media/video 主 frame 检查与 display-capture 请求均不消费 token", () => {
    const pm = new PermissionManager();
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    expect(pm.shouldAllowPermissionCheck(42, "media", {
      mediaType: "video",
      isMainFrame: true,
    })).toBe(true);
    expect(pm.shouldAllowPermissionCheck(42, "media", {
      mediaType: "video",
      isMainFrame: false,
    })).toBe(false);
    expect(pm.shouldAllowPermissionCheck(42, "media", {
      mediaType: "audio",
      isMainFrame: true,
    })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "display-capture")).toBe(true);
    expect(pm.shouldAllowPermissionRequest(42, "media", { mediaTypes: [] })).toBe(true);

    const auth = pm.consumeCaptureAuth(42);
    expect(auth?.sourceId).toBe("screen:0");
    expect(pm.consumeCaptureAuth(42)).toBeNull();
    expect(pm.shouldAllowPermissionCheck(42, "media", {
      mediaType: "video",
      isMainFrame: true,
    })).toBe(false);
    expect(pm.shouldAllowPermissionRequest(42, "display-capture")).toBe(false);
  });

  it("非专用窗口无法消费授权", () => {
    const pm = new PermissionManager();
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    expect(pm.consumeCaptureAuth(99)).toBeNull();
    expect(pm.hasActiveCaptureAuth()).toBe(true);
  });

  it("token 超时自动失效", async () => {
    const pm = new PermissionManager({ tokenTtlMs: 20 });
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    // 延迟 30ms 超过 TTL
    await new Promise((r) => setTimeout(r, 30));

    expect(pm.shouldAllowPermissionCheck(42, "media", {
      mediaType: "video",
      isMainFrame: true,
    })).toBe(false);
  });

  it("主动 revoke 立即失效", () => {
    const pm = new PermissionManager();
    pm.setCaptureWebContentsId(42);
    pm.issueCaptureAuth("screen:0");

    pm.revokeCaptureAuth();

    expect(pm.shouldAllowPermissionRequest(42, "display-capture")).toBe(false);
  });
});
