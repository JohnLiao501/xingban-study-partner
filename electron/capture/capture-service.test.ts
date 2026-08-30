/**
 * CaptureService 单元测试
 *
 * 验证：
 * - FakeCaptureService 状态流转与单帧回放
 * - ElectronCaptureService 授权发放与窗口消息派发
 * - 单帧请求并发互斥锁（防止连续触发堆积）
 * - 超时自动解锁降级为 null
 * - 停止共享与流结束清理
 */

import { describe, it, expect } from "vitest";
import { FakeCaptureService, ElectronCaptureService } from "./capture-service.js";
import { PermissionManager } from "../security/permission-manager.js";
import type { BrowserWindow } from "electron";

describe("FakeCaptureService", () => {
  it("默认状态为 inactive，未激活时无法获取帧", async () => {
    const service = new FakeCaptureService();
    expect(service.getStatus()).toBe("inactive");
    expect(await service.captureFrame()).toBeNull();
  });

  it("激活后可获取模拟单帧，停止后恢复 stopped", async () => {
    const service = new FakeCaptureService();
    const mockData = new Uint8Array([1, 2, 3, 4]);
    service.setMockFrame(mockData);

    const started = await service.startCapture("screen:0:0");
    expect(started).toBe(true);
    expect(service.getStatus()).toBe("active");

    const frame = await service.captureFrame();
    expect(frame).toEqual(mockData);

    await service.stopCapture();
    expect(service.getStatus()).toBe("stopped");
    expect(await service.captureFrame()).toBeNull();
  });
});

describe("ElectronCaptureService", () => {
  const sourceProvider = async () => [{ id: "screen:1", name: "显示器 1" }];

  function createMockWindow(sendSpy: (channel: string, data?: unknown) => void) {
    return {
      isDestroyed: () => false,
      webContents: {
        send: sendSpy,
      },
    } as unknown as BrowserWindow;
  }

  it("startCapture 发放授权并通知窗口开始媒体流", async () => {
    const pm = new PermissionManager();
    const sentMessages: { channel: string; data?: unknown }[] = [];
    const win = createMockWindow((channel, data) => sentMessages.push({ channel, data }));
    let sourceProviderCallCount = 0;

    const service = new ElectronCaptureService(() => win, pm, 3000, async () => {
      sourceProviderCallCount += 1;
      return sourceProvider();
    });
    service.handleRendererReady();
    const success = await service.startCapture("screen:1");

    expect(success).toBe(true);
    expect(service.getStatus()).toBe("starting");
    service.handleStreamReady();
    expect(service.getStatus()).toBe("active");
    expect(pm.hasActiveCaptureAuth()).toBe(true);
    expect(sentMessages).toHaveLength(1);
    expect(sentMessages[0]?.channel).toBe("capture:init-stream");
    expect(sentMessages[0]?.data).toBeUndefined();
    expect(sourceProviderCallCount).toBe(0);
  });

  it("startCapture 在进入最终 display-media 校验前拒绝空或超长 sourceId", async () => {
    const pm = new PermissionManager();
    const win = createMockWindow(() => {});
    const service = new ElectronCaptureService(() => win, pm, 3000, sourceProvider);
    service.handleRendererReady();

    expect(await service.startCapture("")).toBe(false);
    expect(await service.startCapture("x".repeat(501))).toBe(false);
    expect(pm.hasActiveCaptureAuth()).toBe(false);
  });

  it("captureFrame 存在并发互斥限制，避免同时重复请求", async () => {
    const pm = new PermissionManager();
    const win = createMockWindow(() => {});

    const service = new ElectronCaptureService(() => win, pm, 100, sourceProvider);
    service.handleRendererReady();
    await service.startCapture("screen:1");
    service.handleStreamReady();

    // 第一个请求正在等待响应
    const p1 = service.captureFrame();

    // 第二个请求在第一个未完成前发起：应直接返回 null
    const p2 = await service.captureFrame();
    expect(p2).toBeNull();

    // 灌入第一个请求的数据
    const fakeFrame = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    service.handleIncomingFrame(fakeFrame);

    const r1 = await p1;
    expect(r1).toEqual(fakeFrame);
  });

  it("captureFrame 超时后自动返回 null 并释放并发锁", async () => {
    const pm = new PermissionManager();
    const win = createMockWindow(() => {});

    // 超时设置为 20ms
    const service = new ElectronCaptureService(() => win, pm, 20, sourceProvider);
    service.handleRendererReady();
    await service.startCapture("screen:1");
    service.handleStreamReady();

    const frame = await service.captureFrame();
    expect(frame).toBeNull();

    // 超时后并发锁已释放，可以进行下一次请求
    const pNext = service.captureFrame();
    service.handleIncomingFrame(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
    expect(await pNext).toEqual(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]));
  });

  it("拒绝非 JPEG、缺少结束标记或超大帧", async () => {
    const pm = new PermissionManager();
    const win = createMockWindow(() => {});
    const service = new ElectronCaptureService(() => win, pm, 100, sourceProvider);
    service.handleRendererReady();
    await service.startCapture("screen:1");
    service.handleStreamReady();

    for (const invalidFrame of [
      new Uint8Array([1, 2, 3, 4]),
      new Uint8Array([0xff, 0xd8, 0, 0]),
      new Uint8Array(2 * 1024 * 1024 + 1),
    ]) {
      const pending = service.captureFrame();
      service.handleIncomingFrame(invalidFrame);
      expect(await pending).toBeNull();
    }
  });

  it("stopCapture 清理授权并通知窗口停止媒体流", async () => {
    const pm = new PermissionManager();
    const sentMessages: string[] = [];
    const win = createMockWindow((channel) => sentMessages.push(channel));

    const service = new ElectronCaptureService(() => win, pm, 3000, sourceProvider);
    service.handleRendererReady();
    await service.startCapture("screen:1");
    service.handleStreamReady();
    expect(service.getStatus()).toBe("active");

    await service.stopCapture();
    expect(service.getStatus()).toBe("stopped");
    expect(pm.hasActiveCaptureAuth()).toBe(false);
    expect(sentMessages).toContain("capture:stop-stream");
  });

  it("等待截图 renderer 明确就绪后才发出初始化消息", async () => {
    const pm = new PermissionManager();
    const sentMessages: string[] = [];
    const win = createMockWindow((channel) => sentMessages.push(channel));
    const service = new ElectronCaptureService(() => win, pm, 100, sourceProvider, 100);

    const pending = service.startCapture("screen:1");
    await Promise.resolve();
    expect(sentMessages).toHaveLength(0);
    service.handleRendererReady();

    expect(await pending).toBe(true);
    expect(sentMessages).toEqual(["capture:init-stream"]);
  });

  it("截图 renderer 未就绪时超时失败且不保留授权", async () => {
    const pm = new PermissionManager();
    const sentMessages: string[] = [];
    const win = createMockWindow((channel) => sentMessages.push(channel));
    const service = new ElectronCaptureService(() => win, pm, 100, sourceProvider, 5);

    expect(await service.startCapture("screen:1")).toBe(false);
    expect(service.getStatus()).toBe("failed");
    expect(pm.hasActiveCaptureAuth()).toBe(false);
    expect(sentMessages).toHaveLength(0);
  });
});
