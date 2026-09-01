/**
 * 屏幕捕获服务抽象与实现
 *
 * 规范：
 * - 仅支持逐场显式授权；
 * - 仅截取低分辨率单帧（最长边 ≤ 768px, JPEG Q60）；
 * - 单帧二进制内存传输，不写磁盘，不转 base64；
 * - 单次并发上限 1，超时保护；
 * - 停止共享立即终止所有媒体流。
 */

import { desktopCapturer, type BrowserWindow } from "electron";
import type { CaptureSourceSummary, CaptureStatus } from "../../shared/inspection.js";
import type { PermissionManager } from "../security/permission-manager.js";

/** 捕获服务接口 */
export interface CaptureService {
  /** 获取可用屏幕源脱敏摘要列表 */
  listSources(): Promise<CaptureSourceSummary[]>;

  /** 用户显式授权后开启屏幕捕获流 */
  startCapture(sourceId: string): Promise<boolean>;

  /** 捕获单个低分辨率 JPEG 帧（返回二进制 Buffer），失败或未授权时返回 null */
  captureFrame(): Promise<Uint8Array | null>;

  /** 停止屏幕捕获并释放所有媒体流 */
  stopCapture(): Promise<void>;

  /** 获取当前捕获状态 */
  getStatus(): CaptureStatus;

  /** 监听捕获状态变更 */
  onStatusChange(listener: (status: CaptureStatus) => void): () => void;
}

/** 测试用 Fake 捕获服务 */
export class FakeCaptureService implements CaptureService {
  private status: CaptureStatus = "inactive";
  private statusListeners: ((status: CaptureStatus) => void)[] = [];
  private frameToReturn: Uint8Array | null = null;
  private sources: CaptureSourceSummary[] = [
    { id: "screen:0:0", name: "显示器 1" },
    { id: "screen:1:0", name: "显示器 2" },
  ];

  setMockFrame(frame: Uint8Array | null): void {
    this.frameToReturn = frame;
  }

  setMockSources(sources: CaptureSourceSummary[]): void {
    this.sources = sources;
  }

  async listSources(): Promise<CaptureSourceSummary[]> {
    return [...this.sources];
  }

  async startCapture(sourceId: string): Promise<boolean> {
    const exists = this.sources.some((s) => s.id === sourceId);
    if (!exists) {
      this.setStatus("failed");
      return false;
    }
    this.setStatus("active");
    return true;
  }

  public captureCallCount = 0;

  async captureFrame(): Promise<Uint8Array | null> {
    this.captureCallCount += 1;
    if (this.status !== "active") return null;
    return this.frameToReturn;
  }

  async stopCapture(): Promise<void> {
    this.setStatus("stopped");
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  onStatusChange(listener: (status: CaptureStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(status: CaptureStatus): void {
    if (this.status === status) return;
    this.status = status;
    for (const l of this.statusListeners) {
      l(status);
    }
  }
}

/**
 * 真实 Electron 屏幕捕获协调服务
 */
export class ElectronCaptureService implements CaptureService {
  private status: CaptureStatus = "inactive";
  private statusListeners: ((status: CaptureStatus) => void)[] = [];
  private activeSourceId: string | null = null;
  private isCapturingFrame = false;
  private pendingFrameResolve: ((frame: Uint8Array | null) => void) | null = null;
  private rendererReady = false;
  private rendererReadyWaiters = new Set<(ready: boolean) => void>();
  private streamStopWaiters = new Set<(stopped: boolean) => void>();
  private streamStopConfirmed = true;
  private startGeneration = 0;

  constructor(
    private readonly getCaptureWindow: () => BrowserWindow | null,
    private readonly permissionManager: PermissionManager,
    private readonly frameTimeoutMs = 3000,
    private readonly sourceProvider?: () => Promise<CaptureSourceSummary[]>,
    private readonly rendererReadyTimeoutMs = 5000,
  ) {}

  async listSources(): Promise<CaptureSourceSummary[]> {
    try {
      if (this.sourceProvider) return await this.sourceProvider();
      // 仅获取全屏显示器类型，不获取单一应用窗口，最大限度保护隐私
      const sources = await desktopCapturer.getSources({
        types: ["screen"],
        thumbnailSize: { width: 0, height: 0 }, // 不需要缩略图，避免消耗内存与内存泄露
        fetchWindowIcons: false,
      });

      return sources.map((s) => ({
        id: s.id,
        name: s.name,
      }));
    } catch {
      return [];
    }
  }

  async startCapture(sourceId: string): Promise<boolean> {
    const win = this.getCaptureWindow();
    if (!win || win.isDestroyed() || sourceId.length < 1 || sourceId.length > 500) {
      this.setStatus("failed");
      return false;
    }

    try {
      if (this.status === "active" || this.status === "starting") {
        await this.stopCapture();
      }

      const generation = ++this.startGeneration;
      if (!await this.waitForRendererReady() || generation !== this.startGeneration) {
        this.permissionManager.revokeCaptureAuth();
        this.setStatus("failed");
        return false;
      }

      // 1. 发放单次授权 token 给 permissionManager
      this.permissionManager.issueCaptureAuth(sourceId);

      // 2. 向 captureWindow 发送初始化流指令；sourceId 只留在主进程。
      //    Electron display-media handler 会重新枚举并强制返回当前仍存在的该源，
      //    因此这里不重复调用 desktopCapturer，避免一次无意义的系统捕获初始化。
      this.activeSourceId = sourceId;
      this.streamStopConfirmed = false;
      win.webContents.send("capture:init-stream");
      this.setStatus("starting");
      return true;
    } catch {
      this.permissionManager.revokeCaptureAuth();
      this.streamStopConfirmed = true;
      this.setStatus("failed");
      return false;
    }
  }

  /** 截图 renderer 在所有受限 IPC 监听器绑定后调用。 */
  handleRendererReady(): void {
    this.rendererReady = true;
    for (const resolve of [...this.rendererReadyWaiters]) resolve(true);
  }

  /** 页面重载、renderer 崩溃或窗口销毁时撤销就绪状态并取消等待。 */
  handleRendererUnavailable(): void {
    this.rendererReady = false;
    for (const resolve of [...this.rendererReadyWaiters]) resolve(false);
    this.streamStopConfirmed = true;
    for (const resolve of [...this.streamStopWaiters]) resolve(true);
  }

  /** 截图窗口确认 MediaStream 已建立后才进入 active。 */
  handleStreamReady(): void {
    if (this.status === "starting" && this.activeSourceId) {
      this.setStatus("active");
    }
  }

  /** 截图 renderer 已同步 stop() 全部 MediaStreamTrack 后确认。 */
  handleStreamStopped(): void {
    this.streamStopConfirmed = true;
    for (const resolve of [...this.streamStopWaiters]) resolve(true);
  }

  /** 供主进程显示媒体授权回调确认本次异步选源仍属于当前启动流程。 */
  isAwaitingStream(sourceId: string): boolean {
    return this.status === "starting" && this.activeSourceId === sourceId;
  }

  async captureFrame(): Promise<Uint8Array | null> {
    if (this.status !== "active") return null;

    // 单次并发互斥防堆积
    if (this.isCapturingFrame) {
      return null;
    }

    const win = this.getCaptureWindow();
    if (!win || win.isDestroyed()) {
      this.setStatus("failed");
      return null;
    }

    this.isCapturingFrame = true;

    return new Promise<Uint8Array | null>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingFrameResolve === resolveCallback) {
          this.pendingFrameResolve = null;
          this.isCapturingFrame = false;
          resolve(null);
        }
      }, this.frameTimeoutMs);

      const resolveCallback = (data: Uint8Array | null) => {
        clearTimeout(timer);
        this.pendingFrameResolve = null;
        this.isCapturingFrame = false;
        resolve(data);
      };

      this.pendingFrameResolve = resolveCallback;
      // 触发截图窗口绘制单帧并回传
      win.webContents.send("capture:request-frame");
    });
  }

  /** 接收来自 captureWindow 的单帧二进制数据 */
  handleIncomingFrame(frameData: Uint8Array | null): void {
    if (this.pendingFrameResolve) {
      const validFrame = frameData === null || (
        frameData.byteLength >= 4 &&
        frameData.byteLength <= 2 * 1024 * 1024 &&
        frameData[0] === 0xff &&
        frameData[1] === 0xd8 &&
        frameData[frameData.byteLength - 2] === 0xff &&
        frameData[frameData.byteLength - 1] === 0xd9
      );
      this.pendingFrameResolve(validFrame ? frameData : null);
    }
  }

  /** 接收来自 captureWindow 的流结束通知 */
  handleStreamEnded(): void {
    this.streamStopConfirmed = true;
    void this.stopCapture();
  }

  async stopCapture(): Promise<void> {
    this.startGeneration += 1;
    this.activeSourceId = null;
    this.permissionManager.revokeCaptureAuth();

    if (this.pendingFrameResolve) {
      this.pendingFrameResolve(null);
      this.pendingFrameResolve = null;
    }
    this.isCapturingFrame = false;

    const win = this.getCaptureWindow();
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send("capture:stop-stream");
      } catch {
        // 忽略窗口销毁异常
      }
    }

    this.setStatus("stopped");
  }

  /**
   * 应用退出专用：发送停止命令后等待截图 renderer 的 track.stop() 回执。
   * 超时返回 false，由外层验收按失败处理；普通会话停止仍保持即时降级语义。
   */
  async stopCaptureAndWait(timeoutMs = 2_000): Promise<boolean> {
    const shouldWait = !this.streamStopConfirmed;
    if (!shouldWait) {
      await this.stopCapture();
      return true;
    }
    const acknowledgement = new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (stopped: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.streamStopWaiters.delete(finish);
        resolve(stopped);
      };
      const timer = setTimeout(() => finish(false), timeoutMs);
      this.streamStopWaiters.add(finish);
    });
    await this.stopCapture();
    return acknowledgement;
  }

  getStatus(): CaptureStatus {
    return this.status;
  }

  onStatusChange(listener: (status: CaptureStatus) => void): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  private setStatus(newStatus: CaptureStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const l of this.statusListeners) {
      l(newStatus);
    }
  }

  private waitForRendererReady(): Promise<boolean> {
    if (this.rendererReady) return Promise.resolve(true);

    return new Promise((resolve) => {
      let settled = false;
      const finish = (ready: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.rendererReadyWaiters.delete(finish);
        resolve(ready);
      };
      const timer = setTimeout(() => finish(false), this.rendererReadyTimeoutMs);
      this.rendererReadyWaiters.add(finish);
    });
  }
}
