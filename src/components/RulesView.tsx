import { useState, type FormEvent } from "react";
import type {
  AppRule,
  RuleDecision,
  RuleMatchType,
  SaveAppRuleInput,
} from "../../shared/rules";

interface RulesViewProps {
  error?: string;
  rules: AppRule[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onSave: (input: SaveAppRuleInput) => void;
  onToggle: (rule: AppRule) => void;
}

const MATCH_LABELS: Record<RuleMatchType, string> = {
  process: "进程名",
  "window-title": "窗口标题",
};

const DECISION_LABELS: Record<RuleDecision, string> = {
  allow: "允许学习",
  block: "禁止分心",
};

export function RulesView({ error, rules, onBack, onDelete, onSave, onToggle }: RulesViewProps) {
  const [matchType, setMatchType] = useState<RuleMatchType>("process");
  const [decision, setDecision] = useState<RuleDecision>("allow");
  const [pattern, setPattern] = useState("");

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pattern.trim()) return;
    onSave({ matchType, decision, pattern, enabled: true });
    setPattern("");
  };

  return (
    <main className="rules-view">
      <header className="rules-header">
        <div>
          <span className="history-eyebrow">LOCAL FOCUS RULES</span>
          <h1>本地判断规则</h1>
          <p>规则只保存在本机。窗口探针将在下一阶段读取它们。</p>
        </div>
        <button className="button button--primary" onClick={onBack} type="button">回到督学室</button>
      </header>

      <section className="rules-layout">
        <form className="rule-editor" onSubmit={submit}>
          <h2>新增规则</h2>
          <p>优先使用进程名；窗口标题只填写稳定且必要的片段。</p>
          <label>
            <span>匹配对象</span>
            <select onChange={(event) => setMatchType(event.target.value as RuleMatchType)} value={matchType}>
              <option value="process">进程名</option>
              <option value="window-title">窗口标题</option>
            </select>
          </label>
          <label>
            <span>判断结果</span>
            <select onChange={(event) => setDecision(event.target.value as RuleDecision)} value={decision}>
              <option value="allow">允许学习</option>
              <option value="block">禁止分心</option>
            </select>
          </label>
          <label>
            <span>匹配内容</span>
            <input
              maxLength={200}
              onChange={(event) => setPattern(event.target.value)}
              placeholder={matchType === "process" ? "例如：Obsidian.exe" : "例如：课程回放"}
              required
              value={pattern}
            />
          </label>
          <div className="rule-editor__privacy">
            应用不会保存真实窗口标题；后续观察记录最多保存其 SHA-256 摘要。
          </div>
          {error ? <p className="rule-error" role="alert">{error}</p> : null}
          <button className="button button--primary" type="submit">保存本地规则</button>
        </form>

        <section className="rule-list" aria-label="已保存规则">
          <div className="rule-list__header">
            <h2>已保存规则</h2>
            <span>{rules.length} 条</span>
          </div>
          {rules.length === 0 ? (
            <div className="rule-list__empty">暂时没有规则。没有规则时，未来巡查会进入不确定流程，而不会直接处罚。</div>
          ) : (
            rules.map((rule) => (
              <article className={`rule-row rule-row--${rule.decision}`} key={rule.id}>
                <span className="rule-decision">{DECISION_LABELS[rule.decision]}</span>
                <div>
                  <h3>{rule.pattern}</h3>
                  <p>{MATCH_LABELS[rule.matchType]}</p>
                </div>
                <label className="rule-switch">
                  <input checked={rule.enabled} onChange={() => onToggle(rule)} type="checkbox" />
                  <span>{rule.enabled ? "启用" : "停用"}</span>
                </label>
                <button className="rule-delete" onClick={() => onDelete(rule.id)} type="button">删除</button>
              </article>
            ))
          )}
        </section>
      </section>
    </main>
  );
}
