/**
 * 本地规则分类器
 *
 * 根据前台探针样本和本场启用的规则，做出本地判断：
 * - allow 持续命中 → focused
 * - block 连续命中 ≥ 20 秒 → distracted
 * - allow 与 block 同时命中 → conflict（返回 unknown）
 * - 无规则匹配或探针不可用 → unknown
 *
 * 本模块是纯逻辑，不依赖 Electron、网络或文件系统。
 */

import type { AppRule } from "../../shared/rules.js";
import type { ForegroundSample } from "../../shared/inspection.js";

/** 分类结果 */
export type ClassificationResult =
  | { verdict: "focused"; reason: "allowed_app" }
  | { verdict: "distracted"; reason: "blocked_app" }
  | { verdict: "unknown"; reason: "no_match" | "conflict" | "probe_unavailable" | "block_duration_insufficient" };

/** block 判定需要的最小连续持续时间 */
const BLOCK_CONFIRM_MS = 20_000;

/** 超过两个常规采样周期仍无新样本时，不再视为连续。 */
const MAX_CONSECUTIVE_SAMPLE_GAP_MS = 10_000;

/**
 * 规范化进程名：去除首尾空白、转小写、去除 .exe 后缀
 */
function normalizeProcessName(name: string): string {
  let normalized = name.trim().toLowerCase();
  if (normalized.endsWith(".exe")) {
    normalized = normalized.slice(0, -4);
  }
  return normalized;
}

/**
 * 检查一个值是否匹配规则模式
 *
 * 支持精确匹配和简单通配符（* 匹配任意字符序列）。
 * 不支持正则表达式，避免用户输入被当作任意正则执行。
 */
function matchesPattern(value: string, pattern: string, caseInsensitive: boolean): boolean {
  const normalizedValue = caseInsensitive ? value.toLowerCase() : value;
  const normalizedPattern = caseInsensitive ? pattern.toLowerCase() : pattern;

  // 没有通配符，精确匹配
  if (!normalizedPattern.includes("*")) {
    return normalizedValue === normalizedPattern;
  }

  // 将通配符模式转为正则：转义特殊字符，* 替换为 .*
  const escaped = normalizedPattern
    .split("*")
    .map((segment) => segment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(normalizedValue);
}

/**
 * 检查单条规则是否匹配当前样本
 */
function ruleMatches(rule: AppRule, sample: ForegroundSample): boolean {
  if (!rule.enabled) return false;

  if (rule.matchType === "process") {
    const normalizedSample = normalizeProcessName(sample.processName);
    const normalizedPattern = normalizeProcessName(rule.pattern);
    return matchesPattern(normalizedSample, normalizedPattern, true);
  }

  if (rule.matchType === "window-title") {
    return matchesPattern(sample.windowTitle, rule.pattern, false);
  }

  return false;
}

/**
 * 本地规则分类器
 *
 * 维护 block 连续累计时间的内部状态。
 * 每次调用 classify() 传入最新样本和本场规则，返回分类结果。
 */
export class LocalRuleClassifier {
  private blockStartedAtMs: number | null = null;
  private lastBlockSampleAtMs: number | null = null;
  private blockIdentity: string | null = null;
  /** 当前连续段是否已跨过 20 秒阈值；跨过后在同一段内保持 distracted 状态 */
  private blockConfirmed = false;
  private latestSampleKey: string | null = null;
  private latestRulesKey: string | null = null;
  private latestResult: ClassificationResult = { verdict: "unknown", reason: "probe_unavailable" };

  /**
   * 对当前样本进行本地规则分类
   *
   * @param sample 最新前台样本，null 表示探针不可用
   * @param rules 本场启用的规则列表
   */
  observe(
    sample: ForegroundSample | null,
    rules: AppRule[],
  ): ClassificationResult {
    // 探针不可用
    if (sample === null) {
      this.resetBlockAccumulation();
      return this.remember(null, rules, { verdict: "unknown", reason: "probe_unavailable" });
    }

    // 筛选启用的规则
    const enabledRules = rules.filter((r) => r.enabled);
    if (enabledRules.length === 0) {
      this.resetBlockAccumulation();
      return this.remember(sample, rules, { verdict: "unknown", reason: "no_match" });
    }

    // 检查哪些规则匹配
    const matchedAllowRules = enabledRules.filter(
      (r) => r.decision === "allow" && ruleMatches(r, sample),
    );
    const matchedBlockRules = enabledRules.filter(
      (r) => r.decision === "block" && ruleMatches(r, sample),
    );
    const matchedAllow = matchedAllowRules.length > 0;
    const matchedBlock = matchedBlockRules.length > 0;

    // allow 与 block 同时命中 → 冲突
    if (matchedAllow && matchedBlock) {
      this.resetBlockAccumulation();
      return this.remember(sample, rules, { verdict: "unknown", reason: "conflict" });
    }

    // allow 命中
    if (matchedAllow) {
      this.resetBlockAccumulation();
      return this.remember(sample, rules, { verdict: "focused", reason: "allowed_app" });
    }

    // block 命中
    if (matchedBlock) {
      const sampleAtMs = Date.parse(sample.capturedAt);
      const currentIdentity = [
        normalizeProcessName(sample.processName),
        String(sample.pid),
        ...matchedBlockRules.map((rule) => rule.id).sort(),
      ].join("|");
      const gapMs = this.lastBlockSampleAtMs === null ? 0 : sampleAtMs - this.lastBlockSampleAtMs;
      const sequenceBroken = this.blockIdentity !== currentIdentity ||
        this.lastBlockSampleAtMs === null ||
        gapMs <= 0 ||
        gapMs > MAX_CONSECUTIVE_SAMPLE_GAP_MS;

      if (sequenceBroken) {
        this.blockStartedAtMs = sampleAtMs;
        this.blockConfirmed = false;
      }
      this.blockIdentity = currentIdentity;
      this.lastBlockSampleAtMs = sampleAtMs;

      const elapsedMs = sampleAtMs - (this.blockStartedAtMs ?? sampleAtMs);
      if (this.blockConfirmed || elapsedMs >= BLOCK_CONFIRM_MS) {
        // 一旦跨过 20 秒阈值，在同一连续段内保持 distracted 状态（锁存），
        // 直到应用切换、样本断档或规则不再命中。这样巡查节点读到的是"状态"
        // 而不是"边沿"：此前确认后立即重置会让偏航只在跨越阈值的那一个样本上
        // 短暂出现，固定巡查节点几乎必然读到重置后的 block_duration_insufficient
        // （2026-09-01 人工场与 2026-09-02 B1 三次复现的同一缺陷）。
        this.blockConfirmed = true;
        return this.remember(sample, rules, { verdict: "distracted", reason: "blocked_app" });
      }

      return this.remember(sample, rules, { verdict: "unknown", reason: "block_duration_insufficient" });
    }

    // 无规则匹配
    this.resetBlockAccumulation();
    return this.remember(sample, rules, { verdict: "unknown", reason: "no_match" });
  }

  /** 向后兼容的测试入口；语义等同于接收一个新的探针样本。 */
  classify(sample: ForegroundSample | null, rules: AppRule[]): ClassificationResult {
    return this.observe(sample, rules);
  }

  /** 读取最近一个已观察样本的结果；未观察过该样本时只把它作为序列起点。 */
  getCurrent(sample: ForegroundSample | null, rules: AppRule[]): ClassificationResult {
    const sampleKey = sample ? this.sampleKey(sample) : null;
    const rulesKey = this.rulesKey(rules);
    if (sampleKey === this.latestSampleKey && rulesKey === this.latestRulesKey) {
      return this.latestResult;
    }
    return this.observe(sample, rules);
  }

  /** 重置 block 累计状态（应用切换、冲突、探针缺失时调用） */
  resetBlockAccumulation(): void {
    this.blockStartedAtMs = null;
    this.lastBlockSampleAtMs = null;
    this.blockIdentity = null;
    this.blockConfirmed = false;
  }

  reset(): void {
    this.resetBlockAccumulation();
    this.latestSampleKey = null;
    this.latestRulesKey = null;
    this.latestResult = { verdict: "unknown", reason: "probe_unavailable" };
  }

  private remember(
    sample: ForegroundSample | null,
    rules: AppRule[],
    result: ClassificationResult,
  ): ClassificationResult {
    this.latestSampleKey = sample ? this.sampleKey(sample) : null;
    this.latestRulesKey = this.rulesKey(rules);
    this.latestResult = result;
    return result;
  }

  private sampleKey(sample: ForegroundSample): string {
    return `${sample.capturedAt}|${sample.pid}|${sample.processName}|${sample.windowTitle}`;
  }

  private rulesKey(rules: AppRule[]): string {
    return rules
      .map((rule) => `${rule.id}:${rule.enabled}:${rule.decision}:${rule.matchType}:${rule.pattern}`)
      .sort()
      .join("|");
  }
}
