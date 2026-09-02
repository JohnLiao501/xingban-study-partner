/**
 * LocalRuleClassifier 测试
 *
 * 覆盖：20 秒 block 边界、allow、冲突、无规则、探针缺失、
 *       应用切换重置、大小写、通配符、规则停用
 */
import { describe, it, expect, beforeEach } from "vitest";
import { LocalRuleClassifier } from "./local-rule-classifier.js";
import { createSample } from "./fake-foreground-probe.js";
import type { AppRule } from "../../shared/rules.js";

/** 创建测试规则的辅助函数 */
function createRule(
  decision: "allow" | "block",
  matchType: "process" | "window-title",
  pattern: string,
  enabled = true,
): AppRule {
  return {
    id: `rule-${Math.random().toString(36).slice(2, 8)}`,
    matchType,
    pattern,
    decision,
    enabled,
    createdAt: new Date().toISOString(),
  };
}

describe("LocalRuleClassifier", () => {
  let classifier: LocalRuleClassifier;
  const baseTime = Date.parse("2026-08-29T08:00:00.000Z");
  const sampleAt = (processName: string, seconds: number, windowTitle = "") =>
    createSample(processName, windowTitle, 1234, new Date(baseTime + seconds * 1000).toISOString());

  beforeEach(() => {
    classifier = new LocalRuleClassifier();
  });

  // === allow 规则 ===

  it("allow 规则匹配时返回 focused", () => {
    const rules = [createRule("allow", "process", "code")];
    const result = classifier.classify(createSample("code"), rules);
    expect(result.verdict).toBe("focused");
    expect(result.reason).toBe("allowed_app");
  });

  it("进程名大小写不敏感", () => {
    const rules = [createRule("allow", "process", "Code")];
    const result = classifier.classify(createSample("CODE"), rules);
    expect(result.verdict).toBe("focused");
  });

  it("进程名去除 .exe 后缀后匹配", () => {
    const rules = [createRule("allow", "process", "notepad")];
    const result = classifier.classify(createSample("notepad.exe"), rules);
    expect(result.verdict).toBe("focused");
  });

  it("规则模式含 .exe 也能匹配裸名", () => {
    const rules = [createRule("allow", "process", "notepad.exe")];
    const result = classifier.classify(createSample("notepad"), rules);
    expect(result.verdict).toBe("focused");
  });

  // === block 规则与 20 秒边界 ===

  it("block 不足 20 秒时返回 unknown (block_duration_insufficient)", () => {
    const rules = [createRule("block", "process", "bilibili")];
    for (const seconds of [0, 5, 10, 15]) {
      const result = classifier.classify(sampleAt("bilibili", seconds), rules);
      expect(result.verdict).toBe("unknown");
      expect(result.reason).toBe("block_duration_insufficient");
    }
  });

  it("block 达到 20 秒时确认 distracted", () => {
    const rules = [createRule("block", "process", "bilibili")];
    let lastResult;
    for (const seconds of [0, 5, 10, 15, 20]) {
      lastResult = classifier.classify(sampleAt("bilibili", seconds), rules);
    }
    expect(lastResult!.verdict).toBe("distracted");
    expect(lastResult!.reason).toBe("blocked_app");
  });

  it("block 恰好 15 秒不确认", () => {
    const rules = [createRule("block", "process", "game")];
    let result;
    for (const seconds of [0, 5, 10, 15]) {
      result = classifier.classify(sampleAt("game", seconds), rules);
    }
    expect(result!.verdict).toBe("unknown");
  });

  it("block 10 秒后应用切换重置累计", () => {
    const rules = [
      createRule("block", "process", "bilibili"),
      createRule("block", "process", "youtube"),
    ];
    classifier.classify(sampleAt("bilibili", 0), rules);
    classifier.classify(sampleAt("bilibili", 5), rules);
    classifier.classify(sampleAt("bilibili", 10), rules);
    // 切换到 youtube，累计应该重置
    classifier.classify(sampleAt("youtube", 15), rules);
    classifier.classify(sampleAt("youtube", 20), rules);
    const r3 = classifier.classify(sampleAt("youtube", 25), rules);
    expect(r3.verdict).toBe("unknown");
  });

  it("确认 distracted 后在同一连续段内保持命中（锁存语义）", () => {
    const rules = [createRule("block", "process", "bilibili")];
    for (const seconds of [0, 5, 10, 15, 20]) {
      classifier.classify(sampleAt("bilibili", seconds), rules);
    }
    // 跨过 20 秒阈值后，同一连续段内的后续样本必须继续返回 distracted，
    // 否则固定巡查节点只能碰巧在跨越阈值的同一个样本上读到偏航
    // （2026-09-01 人工场与 2026-09-02 B1 复现的缺陷）。
    for (const seconds of [25, 30, 35, 40]) {
      const result = classifier.classify(sampleAt("bilibili", seconds), rules);
      expect(result.verdict).toBe("distracted");
      expect(result.reason).toBe("blocked_app");
    }
  });

  it("确认 distracted 后切换应用再切回，需要重新累计 20 秒", () => {
    const rules = [createRule("block", "process", "bilibili")];
    for (const seconds of [0, 5, 10, 15, 20]) {
      classifier.classify(sampleAt("bilibili", seconds), rules);
    }
    // 切到无规则窗口打断连续段
    classifier.classify(sampleAt("editor", 25), rules);
    // 切回同一禁止应用：作为新的连续段重新累计
    classifier.classify(sampleAt("bilibili", 30), rules);
    const early = classifier.classify(sampleAt("bilibili", 35), rules);
    expect(early.verdict).toBe("unknown");
    expect(early.reason).toBe("block_duration_insufficient");
    classifier.classify(sampleAt("bilibili", 40), rules);
    classifier.classify(sampleAt("bilibili", 45), rules);
    const late = classifier.classify(sampleAt("bilibili", 50), rules);
    expect(late.verdict).toBe("distracted");
  });

  // === 冲突 ===

  it("allow 与 block 同时命中返回 conflict", () => {
    const rules = [
      createRule("allow", "process", "code"),
      createRule("block", "process", "code"),
    ];
    const result = classifier.classify(createSample("code"), rules);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("conflict");
  });

  // === 无规则 ===

  it("无规则时返回 no_match", () => {
    const result = classifier.classify(createSample("code"), []);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("no_match");
  });

  it("规则存在但无匹配时返回 no_match", () => {
    const rules = [createRule("allow", "process", "code")];
    const result = classifier.classify(createSample("notepad"), rules);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("no_match");
  });

  // === 探针不可用 ===

  it("探针不可用（sample=null）返回 probe_unavailable", () => {
    const rules = [createRule("allow", "process", "code")];
    const result = classifier.classify(null, rules);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("probe_unavailable");
  });

  it("探针不可用时重置 block 累计", () => {
    const rules = [createRule("block", "process", "bilibili")];
    for (const seconds of [0, 5, 10, 15]) {
      classifier.classify(sampleAt("bilibili", seconds), rules);
    }
    // 探针中断
    classifier.classify(null, rules);
    // 恢复后从 0 开始累计
    for (const seconds of [20, 25, 30, 35]) {
      const result = classifier.classify(sampleAt("bilibili", seconds), rules);
      expect(result.verdict).toBe("unknown");
      expect(result.reason).toBe("block_duration_insufficient");
    }
  });

  // === 规则停用 ===

  it("停用的规则不参与匹配", () => {
    const rules = [createRule("allow", "process", "code", false)];
    const result = classifier.classify(createSample("code"), rules);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("no_match");
  });

  // === 窗口标题匹配 ===

  it("窗口标题精确匹配", () => {
    const rules = [createRule("allow", "window-title", "study.ts - Visual Studio Code")];
    const result = classifier.classify(
      createSample("code", "study.ts - Visual Studio Code"),
      rules,
    );
    expect(result.verdict).toBe("focused");
  });

  it("窗口标题通配符匹配", () => {
    const rules = [createRule("allow", "window-title", "* - Visual Studio Code")];
    const result = classifier.classify(
      createSample("code", "main.ts - Visual Studio Code"),
      rules,
    );
    expect(result.verdict).toBe("focused");
  });

  it("窗口标题大小写敏感", () => {
    const rules = [createRule("allow", "window-title", "Study")];
    const result = classifier.classify(createSample("code", "study"), rules);
    expect(result.verdict).toBe("unknown");
  });

  // === 进程名通配符 ===

  it("进程名通配符匹配", () => {
    const rules = [createRule("block", "process", "bili*")];
    const result = classifier.classify(createSample("bilibili"), rules);
    expect(result.verdict).toBe("unknown");
    expect(result.reason).toBe("block_duration_insufficient");
  });

  it("连续样本间隔超过 10 秒时重置累计", () => {
    const rules = [createRule("block", "process", "game")];
    classifier.classify(sampleAt("game", 0), rules);
    classifier.classify(sampleAt("game", 5), rules);
    const afterGap = classifier.classify(sampleAt("game", 16), rules);
    expect(afterGap.verdict).toBe("unknown");
    expect(classifier.classify(sampleAt("game", 31), rules).verdict).toBe("unknown");
  });
});
