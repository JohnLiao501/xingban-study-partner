/**
 * 前台应用探针接口
 *
 * 定义 Windows 前台窗口采样的统一契约。
 * 真实实现使用 Win32 sidecar，测试使用 FakeForegroundProbe。
 */

import type { ForegroundSample, ForegroundProbeStatus } from "../../shared/inspection.js";

/** 新样本回调 */
export type OnSampleCallback = (sample: ForegroundSample) => void;

/** 探针状态变化回调 */
export type OnProbeStatusCallback = (status: ForegroundProbeStatus) => void;

/**
 * 前台应用探针接口
 *
 * 实现者负责定期采样当前前台窗口信息（进程名、窗口标题、PID）。
 * 主进程和业务逻辑不应依赖真实 Windows 才能测试。
 */
export interface ForegroundProbe {
  /** 启动采样，每次采样调用 onSample */
  start(onSample: OnSampleCallback): void;

  /** 停止采样，释放资源 */
  stop(): void;

  /** 获取最近一次有效样本，无样本时返回 null */
  getLatest(): ForegroundSample | null;

  /** 获取当前探针状态 */
  getStatus(): ForegroundProbeStatus;

  /** 注册状态变化监听器，返回取消注册函数 */
  onStatusChange(listener: OnProbeStatusCallback): () => void;
}
