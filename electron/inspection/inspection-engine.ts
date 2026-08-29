/**
 * 巡查编排引擎 (InspectionEngine)
 *
 * 核心职责：
 * 1. 本地规则优先 (Local-First)：命中允许应用绝不截图、绝不调用 AI；
 * 2. 连续 20 秒禁止应用自动确认偏航；
 * 3. 规则未知时，在授权齐全下获取单帧并调用多模态适配器；
 * 4. AI 分心必须在 15 秒后使用新帧进行二次独立确认（置信度均 ≥ 0.80）；
 * 5. 应用切换、暂停、停止捕获时立即取消二次确认；
 * 6. 所有异常和低置信度一律安全降级为 uncertain，绝不误罚用户。
 */

import type { AppRule } from "../../shared/rules.js";
import type {
  ForegroundSample,
  InspectionResult,
  ObservationReasonCode,
} from "../../shared/inspection.js";
import type { ForegroundProbe } from "./foreground-probe.js";
import type { LocalRuleClassifier } from "./local-rule-classifier.js";
import type { CaptureService } from "../capture/capture-service.js";
import type { VisionAdapter } from "../vision/vision-adapter.js";
import { hashWindowTitle } from "./observation.js";

export interface InspectionEngineOptions {
  sessionId: string;
  goal: string;
  visionEnabled: boolean;
  sendWindowTitle: boolean;
  rules: AppRule[];
  probe: ForegroundProbe;
  classifier: LocalRuleClassifier;
  captureService: CaptureService;
  visionAdapter: VisionAdapter;
  /** AI 二次确认等待时间（毫秒），生产环境固定 15000ms，测试可注入 */
  confirmationDelayMs?: number;
  /** 触发确认偏航扣减的回调 */
  onConfirmDeviation: (sessionId: string) => void;
  /** 产生观察记录的回调 */
  onObservation: (result: InspectionResult, confirmedDeviation: boolean) => void;
}

export class InspectionEngine {
  private readonly sessionId: string;
  private readonly goal: string;
  private readonly visionEnabled: boolean;
  private readonly sendWindowTitle: boolean;
  private rules: AppRule[];

  private readonly probe: ForegroundProbe;
  private readonly classifier: LocalRuleClassifier;
  private readonly captureService: CaptureService;
  private readonly visionAdapter: VisionAdapter;
  private readonly confirmationDelayMs: number;
  private readonly onConfirmDeviation: (sessionId: string) => void;
  private readonly onObservation: (result: InspectionResult, confirmedDeviation: boolean) => void;

  /** 正在等待 15 秒二次确认的任务 */
  private pendingConfirmation: {
    timer: ReturnType<typeof setTimeout>;
    initialProcessName: string;
  } | null = null;

  constructor(options: InspectionEngineOptions) {
    this.sessionId = options.sessionId;
    this.goal = options.goal;
    this.visionEnabled = options.visionEnabled;
    this.sendWindowTitle = options.sendWindowTitle;
    this.rules = options.rules;

    this.probe = options.probe;
    this.classifier = options.classifier;
    this.captureService = options.captureService;
    this.visionAdapter = options.visionAdapter;
    this.confirmationDelayMs = options.confirmationDelayMs ?? 15000;
    this.onConfirmDeviation = options.onConfirmDeviation;
    this.onObservation = options.onObservation;
  }

  /** 更新本场启用的规则 */
  updateRules(rules: AppRule[]): void {
    this.rules = rules;
  }

  /** 是否有待确认的二次判定任务 */
  hasPendingConfirmation(): boolean {
    return this.pendingConfirmation !== null;
  }

  /** 取消待确认的二次判定任务（应用切换、暂停、停止共享时调用） */
  cancelPendingConfirmation(): void {
    if (this.pendingConfirmation) {
      clearTimeout(this.pendingConfirmation.timer);
      this.pendingConfirmation = null;
    }
  }

  /**
   * 执行单次巡查判定
   */
  async inspectOnce(): Promise<InspectionResult> {
    const startTime = Date.now();
    const sample = this.probe.getLatest();

    const appName = sample?.processName ? sample.processName : null;
    const windowTitleHash = hashWindowTitle(sample?.windowTitle);

    // 1. 本地规则优先判定
    const localVerdict = this.classifier.classify(sample, this.rules);

    if (localVerdict.verdict === "focused") {
      // 本地命中白名单：绝不截图、绝不调用 AI
      this.cancelPendingConfirmation();
      const result: InspectionResult = {
        label: "focused",
        confidence: 1.0,
        reasonCode: "allowed_app",
        source: "local-rule",
        appName,
        windowTitleHash,
        latencyMs: Date.now() - startTime,
        errorCode: null,
      };
      this.onObservation(result, false);
      return result;
    }

    if (localVerdict.verdict === "distracted") {
      // 本地命中黑名单持续满 20 秒：确认分心，消耗偏航额度
      this.cancelPendingConfirmation();
      this.onConfirmDeviation(this.sessionId);
      const result: InspectionResult = {
        label: "distracted",
        confidence: 1.0,
        reasonCode: "blocked_app",
        source: "local-rule",
        appName,
        windowTitleHash,
        latencyMs: Date.now() - startTime,
        errorCode: null,
      };
      this.onObservation(result, true);
      return result;
    }

    // 2. 本地规则未知 (unknown)，进入屏幕与 AI 判定流程
    // 检查是否有前台样本
    if (!sample || !sample.processName) {
      return this.fallbackUncertain(startTime, "insufficient_evidence", appName, windowTitleHash);
    }

    // 如果正在等待二次确认，先不开启新的平行判定
    if (this.pendingConfirmation) {
      return this.fallbackUncertain(startTime, "insufficient_evidence", appName, windowTitleHash);
    }

    // 检查是否具备屏幕捕获与 AI 授权条件
    const canCapture =
      this.visionEnabled &&
      this.captureService.getStatus() === "active" &&
      this.visionAdapter.isConfigured();

    if (!canCapture) {
      // 未开启屏幕捕获或未配置 AI：安全降级为 uncertain，不处罚
      const reason: ObservationReasonCode =
        this.captureService.getStatus() !== "active"
          ? "capture_unavailable"
          : "insufficient_evidence";
      return this.fallbackUncertain(startTime, reason, appName, windowTitleHash);
    }

    // 3. 授权齐全，请求单帧捕获
    let frameData: Uint8Array | null = null;
    try {
      frameData = await this.captureService.captureFrame();
    } catch {
      frameData = null;
    }

    if (!frameData || frameData.byteLength === 0) {
      return this.fallbackUncertain(startTime, "capture_unavailable", appName, windowTitleHash);
    }

    // 4. 调用多模态判定适配器
    try {
      const visionResult = await this.visionAdapter.analyze({
        goal: this.goal,
        processName: sample.processName,
        windowTitle: this.sendWindowTitle ? sample.windowTitle : undefined,
        imageJpeg: frameData,
      });

      // 4.1 AI 判定为 focused
      if (visionResult.label === "focused" && visionResult.confidence >= 0.7) {
        this.cancelPendingConfirmation();
        const result: InspectionResult = {
          label: "focused",
          confidence: visionResult.confidence,
          reasonCode: visionResult.reasonCode,
          source: "vision-api",
          appName,
          windowTitleHash,
          latencyMs: Date.now() - startTime,
          errorCode: null,
        };
        this.onObservation(result, false);
        return result;
      }

      // 4.2 AI 判定为 distracted
      if (visionResult.label === "distracted" && visionResult.confidence >= 0.8) {
        // 初次 AI distracted 绝不立即处罚！启动 15 秒二次独立确认
        this.scheduleConfirmation(sample.processName);

        // 当次返回温和的 uncertain 提醒，绝不消耗偏航额度
        const nudgeResult: InspectionResult = {
          label: "uncertain",
          confidence: visionResult.confidence,
          reasonCode: visionResult.reasonCode,
          source: "vision-api",
          appName,
          windowTitleHash,
          latencyMs: Date.now() - startTime,
          errorCode: null,
        };
        this.onObservation(nudgeResult, false);
        return nudgeResult;
      }

      // 4.3 其他置信度不足或 uncertain
      return this.fallbackUncertain(
        startTime,
        visionResult.reasonCode ?? "insufficient_evidence",
        appName,
        windowTitleHash,
        visionResult.confidence,
      );
    } catch {
      // API 超时、429、500 等全部安全降级
      return this.fallbackUncertain(startTime, "api_unavailable", appName, windowTitleHash);
    }
  }

  /** 调度 15 秒后的第二次单帧独立确认 */
  private scheduleConfirmation(initialProcessName: string): void {
    this.cancelPendingConfirmation();

    const timer = setTimeout(() => {
      void this.executeSecondPass(initialProcessName);
    }, this.confirmationDelayMs);

    this.pendingConfirmation = {
      timer,
      initialProcessName,
    };
  }

  /** 执行第二次单帧独立确认 */
  private async executeSecondPass(expectedProcessName: string): Promise<void> {
    this.pendingConfirmation = null;

    // 1. 检查屏幕流是否仍处于活跃状态
    if (this.captureService.getStatus() !== "active") {
      return;
    }

    // 2. 检查前台应用是否切换
    const currentSample = this.probe.getLatest();
    if (!currentSample || currentSample.processName !== expectedProcessName) {
      // 用户已切走，取消确认
      return;
    }

    const appName = currentSample.processName;
    const windowTitleHash = hashWindowTitle(currentSample.windowTitle);
    const startTime = Date.now();

    // 3. 抽取全新独立单帧（绝不复用上一帧）
    let secondFrame: Uint8Array | null = null;
    try {
      secondFrame = await this.captureService.captureFrame();
    } catch {
      secondFrame = null;
    }

    if (!secondFrame) {
      return;
    }

    // 4. 第二次请求 AI
    try {
      const secondResult = await this.visionAdapter.analyze({
        goal: this.goal,
        processName: currentSample.processName,
        windowTitle: this.sendWindowTitle ? currentSample.windowTitle : undefined,
        imageJpeg: secondFrame,
      });

      // 5. 两次同类结果均 >= 0.80 时，正式确认偏航
      if (secondResult.label === "distracted" && secondResult.confidence >= 0.8) {
        this.onConfirmDeviation(this.sessionId);
        const finalDistracted: InspectionResult = {
          label: "distracted",
          confidence: secondResult.confidence,
          reasonCode: secondResult.reasonCode,
          source: "vision-api",
          appName,
          windowTitleHash,
          latencyMs: Date.now() - startTime,
          errorCode: null,
        };
        this.onObservation(finalDistracted, true);
      } else {
        // 两次结果矛盾或未达阈值，按 uncertain 记录，不扣偏航
        const uncertainResult: InspectionResult = {
          label: "uncertain",
          confidence: secondResult.confidence,
          reasonCode: secondResult.reasonCode,
          source: "vision-api",
          appName,
          windowTitleHash,
          latencyMs: Date.now() - startTime,
          errorCode: null,
        };
        this.onObservation(uncertainResult, false);
      }
    } catch {
      // 第二次失败不处罚
    }
  }

  private fallbackUncertain(
    startTime: number,
    reasonCode: ObservationReasonCode,
    appName: string | null,
    windowTitleHash: string | null,
    confidence = 0,
  ): InspectionResult {
    const result: InspectionResult = {
      label: "uncertain",
      confidence,
      reasonCode,
      source: "fallback",
      appName,
      windowTitleHash,
      latencyMs: Date.now() - startTime,
      errorCode: null,
    };
    this.onObservation(result, false);
    return result;
  }

  /** 销毁引擎，清理未决定时器 */
  dispose(): void {
    this.cancelPendingConfirmation();
  }
}
