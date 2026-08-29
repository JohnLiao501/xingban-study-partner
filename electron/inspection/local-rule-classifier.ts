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

/** block 判定需要的最小连续持续时间（秒） */
const BLOCK_CONFIRM_SECONDS = 20;

/** 采样间隔（秒），用于累计持续时间 */
const SAMPLE_INTERVAL_SECONDS = 5;

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
  /** 当前累计的 block 连续秒数 */
  private blockAccumulatedSeconds = 0;
  /** 上次 block 匹配的进程名（用于检测应用切换） */
  private lastBlockedProcessName: string | null = null;

  /**
   * 对当前样本进行本地规则分类
   *
   * @param sample 最新前台样本，null 表示探针不可用
   * @param rules 本场启用的规则列表
   */
  classify(
    sample: ForegroundSample | null,
    rules: AppRule[],
  ): ClassificationResult {
    // 探针不可用
    if (sample === null) {
      this.resetBlockAccumulation();
      return { verdict: "unknown", reason: "probe_unavailable" };
    }

    // 筛选启用的规则
    const enabledRules = rules.filter((r) => r.enabled);
    if (enabledRules.length === 0) {
      this.resetBlockAccumulation();
      return { verdict: "unknown", reason: "no_match" };
    }

    // 检查哪些规则匹配
    const matchedAllow = enabledRules.some(
      (r) => r.decision === "allow" && ruleMatches(r, sample),
    );
    const matchedBlock = enabledRules.some(
      (r) => r.decision === "block" && ruleMatches(r, sample),
    );

    // allow 与 block 同时命中 → 冲突
    if (matchedAllow && matchedBlock) {
      this.resetBlockAccumulation();
      return { verdict: "unknown", reason: "conflict" };
    }

    // allow 命中
    if (matchedAllow) {
      this.resetBlockAccumulation();
      return { verdict: "focused", reason: "allowed_app" };
    }

    // block 命中
    if (matchedBlock) {
      const currentProcessName = normalizeProcessName(sample.processName);

      // 应用切换时重置累计
      if (this.lastBlockedProcessName !== null &&
          this.lastBlockedProcessName !== currentProcessName) {
        this.resetBlockAccumulation();
      }

      this.lastBlockedProcessName = currentProcessName;
      this.blockAccumulatedSeconds += SAMPLE_INTERVAL_SECONDS;

      if (this.blockAccumulatedSeconds >= BLOCK_CONFIRM_SECONDS) {
        // 确认分心，重置累计（下次从零开始）
        this.resetBlockAccumulation();
        return { verdict: "distracted", reason: "blocked_app" };
      }

      return { verdict: "unknown", reason: "block_duration_insufficient" };
    }

    // 无规则匹配
    this.resetBlockAccumulation();
    return { verdict: "unknown", reason: "no_match" };
  }

  /** 重置 block 累计状态（应用切换、冲突、探针缺失时调用） */
  resetBlockAccumulation(): void {
    this.blockAccumulatedSeconds = 0;
    this.lastBlockedProcessName = null;
  }
}
