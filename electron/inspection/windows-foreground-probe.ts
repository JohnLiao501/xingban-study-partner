/**
 * Windows 前台应用探针真实实现
 *
 * 管理持久运行的 Windows x64 sidecar 子进程。
 * 实现严格的防御性解析、崩溃单次自愈保护与安全清理机制。
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as path from "node:path";
import * as fs from "node:fs";
import type { ForegroundSample, ForegroundProbeStatus } from "../../shared/inspection.js";
import { validateForegroundSample } from "../../shared/inspection.js";
import type {
  ForegroundProbe,
  OnSampleCallback,
  OnProbeStatusCallback,
} from "./foreground-probe.js";

/** 探针配置选项 */
export interface WindowsForegroundProbeOptions {
  /** 自定义 sidecar 可执行文件路径（测试或特殊部署使用） */
  executablePath?: string;
  /** 采样间隔（毫秒），默认 5000 */
  intervalMs?: number;
  /** 单行 stdout 最大允许字符数，防止超大缓冲攻击，默认 4096 */
  maxLineLength?: number;
  /** 最大自动重启次数，默认 1 */
  maxRestartCount?: number;
  /** 重启延迟（毫秒），默认 1000 */
  restartDelayMs?: number;
}

/** 默认定位可执行文件路径 */
export function resolveDefaultProbeExecutable(appPath?: string): string {
  // 开发环境下优先查找项目根目录 resources/bin/
  const baseDir = appPath ?? process.cwd();
  const devPath = path.join(baseDir, "resources", "bin", "windows-foreground-probe.exe");
  if (fs.existsSync(devPath)) {
    return devPath;
  }

  // 生产环境下 Electron process.resourcesPath
  if (process.resourcesPath) {
    const prodPath = path.join(process.resourcesPath, "bin", "windows-foreground-probe.exe");
    if (fs.existsSync(prodPath)) {
      return prodPath;
    }
  }

  return devPath;
}

export class WindowsForegroundProbe implements ForegroundProbe {
  private status: ForegroundProbeStatus = "stopped";
  private latestSample: ForegroundSample | null = null;
  private childProcess: ChildProcess | null = null;
  private lineBuffer = "";
  private restartCount = 0;
  private isIntentionallyStopped = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;

  private sampleListeners: OnSampleCallback[] = [];
  private statusListeners: OnProbeStatusCallback[] = [];

  private readonly executablePath: string;
  private readonly intervalMs: number;
  private readonly maxLineLength: number;
  private readonly maxRestartCount: number;
  private readonly restartDelayMs: number;

  constructor(options: WindowsForegroundProbeOptions = {}) {
    this.executablePath = options.executablePath ?? resolveDefaultProbeExecutable();
    this.intervalMs = options.intervalMs ?? 5000;
    this.maxLineLength = options.maxLineLength ?? 4096;
    this.maxRestartCount = options.maxRestartCount ?? 1;
    this.restartDelayMs = options.restartDelayMs ?? 1000;
  }

  start(onSample: OnSampleCallback): void {
    this.sampleListeners.push(onSample);
    if (this.status === "running") return;

    this.isIntentionallyStopped = false;
    this.restartCount = 0;
    this.spawnProcess();
  }

  stop(): void {
    this.isIntentionallyStopped = true;
    if (this.restartTimer) {
      clearTimeout(this.restartTimer);
      this.restartTimer = null;
    }

    if (this.childProcess) {
      try {
        // 先尝试关闭 stdin 让 sidecar 优雅退出
        this.childProcess.stdin?.end();
        // 随后杀死进程确保不残留
        this.childProcess.kill();
      } catch {
        // 忽略杀死时的错误
      }
      this.childProcess = null;
    }

    this.sampleListeners = [];
    this.setStatus("stopped");
  }

  getLatest(): ForegroundSample | null {
    return this.latestSample;
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

  private setStatus(newStatus: ForegroundProbeStatus): void {
    if (this.status === newStatus) return;
    this.status = newStatus;
    for (const listener of this.statusListeners) {
      listener(newStatus);
    }
  }

  private spawnProcess(): void {
    if (!fs.existsSync(this.executablePath)) {
      this.setStatus("unavailable");
      return;
    }

    try {
      this.lineBuffer = "";
      const args = ["--interval", String(this.intervalMs)];

      const child = spawn(this.executablePath, args, {
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
      });

      this.childProcess = child;
      this.setStatus("running");

      child.stdout?.setEncoding("utf8");
      child.stdout?.on("data", (chunk: string) => {
        this.handleStdoutData(chunk);
      });

      child.stderr?.setEncoding("utf8");
      child.stderr?.on("data", (_chunk: string) => {
        // stderr 丢弃任何敏感信息，仅记录存在错误
      });

      child.on("error", () => {
        this.handleProcessExit(-1);
      });

      child.on("exit", (code) => {
        this.handleProcessExit(code ?? 0);
      });
    } catch {
      this.setStatus("unavailable");
    }
  }

  private handleStdoutData(chunk: string): void {
    this.lineBuffer += chunk;

    let newlineIndex: number;
    while ((newlineIndex = this.lineBuffer.indexOf("\n")) !== -1) {
      const rawLine = this.lineBuffer.slice(0, newlineIndex);
      this.lineBuffer = this.lineBuffer.slice(newlineIndex + 1);

      const line = rawLine.trim();
      if (!line) continue;

      // 行超长防御，防止拒绝服务
      if (line.length > this.maxLineLength) {
        continue;
      }

      this.parseAndDispatchLine(line);
    }

    // 防止未换行的单行缓冲无限膨胀
    if (this.lineBuffer.length > this.maxLineLength) {
      this.lineBuffer = "";
    }
  }

  private parseAndDispatchLine(line: string): void {
    try {
      const parsed = JSON.parse(line);
      const sample = validateForegroundSample(parsed);
      this.latestSample = sample;

      for (const listener of this.sampleListeners) {
        listener(sample);
      }
    } catch {
      // JSON 解析失败或字段不合规时丢弃，不抛出崩溃
    }
  }

  private handleProcessExit(code: number): void {
    this.childProcess = null;
    if (this.isIntentionallyStopped) {
      this.setStatus("stopped");
      return;
    }

    // 意外退出处理：崩溃自愈最多重启一次
    if (this.restartCount < this.maxRestartCount) {
      this.restartCount += 1;
      this.setStatus("restarting");
      this.restartTimer = setTimeout(() => {
        if (!this.isIntentionallyStopped) {
          this.spawnProcess();
        }
      }, this.restartDelayMs);
    } else {
      // 超过重启上限，进入降级状态 unavailable
      this.setStatus("unavailable");
    }
  }
}
