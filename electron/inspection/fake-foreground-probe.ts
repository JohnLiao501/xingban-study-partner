/**
 * 前台探针测试替身
 *
 * 支持预设采样序列重放，用于自动化测试。
 * 可模拟：正常采样、空白、崩溃、恢复、自定义序列。
 */

import type { ForegroundSample, ForegroundProbeStatus } from "../../shared/inspection.js";
import type {
  ForegroundProbe,
  OnSampleCallback,
  OnProbeStatusCallback,
} from "./foreground-probe.js";

export interface FakeProbeOptions {
  /** 预设采样序列，按顺序循环播放 */
  samples?: ForegroundSample[];
  /** 采样间隔（毫秒），默认不自动采样 */
  intervalMs?: number;
  /** 初始状态 */
  initialStatus?: ForegroundProbeStatus;
}

/**
 * 可编程的测试替身探针
 *
 * 支持：
 * - pushSample() 手动注入一个样本
 * - setStatus() 模拟状态变化（崩溃、重启等）
 * - 预设序列自动重放
 */
export class FakeForegroundProbe implements ForegroundProbe {
  private latest: ForegroundSample | null = null;
  private status: ForegroundProbeStatus;
  private sampleListeners: OnSampleCallback[] = [];
  private statusListeners: OnProbeStatusCallback[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence: ForegroundSample[];
  private sequenceIndex = 0;
  private readonly intervalMs: number;

  constructor(options: FakeProbeOptions = {}) {
    this.sequence = options.samples ?? [];
    this.intervalMs = options.intervalMs ?? 0;
    this.status = options.initialStatus ?? "stopped";
  }

  start(onSample: OnSampleCallback): void {
    this.sampleListeners.push(onSample);
    this.setStatus("running");

    if (this.intervalMs > 0 && this.sequence.length > 0 && !this.timer) {
      this.timer = setInterval(() => {
        if (this.status !== "running" || this.sequence.length === 0) return;
        const sample = this.sequence[this.sequenceIndex % this.sequence.length]!;
        this.sequenceIndex += 1;
        this.pushSample(sample);
      }, this.intervalMs);
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.sampleListeners = [];
    this.latest = null;
    this.setStatus("stopped");
  }

  getLatest(): ForegroundSample | null {
    return this.latest;
  }

  getStatus(): ForegroundProbeStatus {
    return this.status;
  }

  onStatusChange(listener: OnProbeStatusCallback): () => void {
    this.statusListeners.push(listener);
    return () => {
      this.statusListeners = this.statusListeners.filter((l) => l !== listener);
    };
  }

  // === 测试控制方法 ===

  /** 手动注入一个样本，触发所有监听器 */
  pushSample(sample: ForegroundSample): void {
    this.latest = sample;
    for (const listener of this.sampleListeners) {
      listener(sample);
    }
  }

  /** 模拟状态变化 */
  setStatus(newStatus: ForegroundProbeStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(newStatus);
    }
  }

  /** 清空最新样本，模拟探针无数据 */
  clearLatest(): void {
    this.latest = null;
  }
}

/** 创建一个简单的 ForegroundSample 测试夹具 */
export function createSample(
  processName: string,
  windowTitle = "",
  pid = 1234,
  capturedAt = new Date().toISOString(),
): ForegroundSample {
  return {
    capturedAt,
    processName,
    windowTitle,
    pid,
  };
}
