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
    // 每次 classify 累加 5 秒，3 次 = 15 秒，不足 20 秒
    for (let i = 0; i < 3; i++) {
      const result = classifier.classify(createSample("bilibili"), rules);
      expect(result.verdict).toBe("unknown");
      expect(result.reason).toBe("block_duration_insufficient");
    }
  });

  it("block 达到 20 秒时确认 distracted", () => {
    const rules = [createRule("block", "process", "bilibili")];
    // 4 次 × 5 秒 = 20 秒
    let lastResult;
    for (let i = 0; i < 4; i++) {
      lastResult = classifier.classify(createSample("bilibili"), rules);
    }
    expect(lastResult!.verdict).toBe("distracted");
    expect(lastResult!.reason).toBe("blocked_app");
  });

  it("block 恰好 15 秒 (3次) 不确认", () => {
    const rules = [createRule("block", "process", "game")];
    let result;
    for (let i = 0; i < 3; i++) {
      result = classifier.classify(createSample("game"), rules);
    }
    expect(result!.verdict).toBe("unknown");
  });

  it("block 10 秒后应用切换重置累计", () => {
    const rules = [
      createRule("block", "process", "bilibili"),
      createRule("block", "process", "youtube"),
    ];
    // bilibili 2 次 = 10 秒
    classifier.classify(createSample("bilibili"), rules);
    classifier.classify(createSample("bilibili"), rules);
    // 切换到 youtube，累计应该重置
    classifier.classify(createSample("youtube"), rules);
    // youtube 再 2 次 = 10 秒（加上切换那次共 15 秒，不应触发）
    classifier.classify(createSample("youtube"), rules);
    const r3 = classifier.classify(createSample("youtube"), rules);
    expect(r3.verdict).toBe("unknown");
  });

  it("确认 distracted 后累计重置", () => {
    const rules = [createRule("block", "process", "bilibili")];
    // 先触发一次 distracted（4×5=20秒）
    for (let i = 0; i < 4; i++) {
      classifier.classify(createSample("bilibili"), rules);
    }
    // 再来 3 次只有 15 秒，不应该触发
    for (let i = 0; i < 3; i++) {
      const result = classifier.classify(createSample("bilibili"), rules);
      expect(result.verdict).toBe("unknown");
    }
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
    // 累计 15 秒
    for (let i = 0; i < 3; i++) {
      classifier.classify(createSample("bilibili"), rules);
    }
    // 探针中断
    classifier.classify(null, rules);
    // 恢复后从 0 开始累计
    for (let i = 0; i < 3; i++) {
      const result = classifier.classify(createSample("bilibili"), rules);
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
});
