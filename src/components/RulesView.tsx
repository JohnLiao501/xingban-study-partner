import { useState, useEffect, type FormEvent } from "react";
import type {
  AppRule,
  RuleDecision,
  RuleMatchType,
  SaveAppRuleInput,
} from "../../shared/rules";
import type { VisionSettingsView } from "../../shared/inspection";

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
  const [activeTab, setActiveTab] = useState<"rules" | "vision">("rules");

  // 本地规则表单状态
  const [matchType, setMatchType] = useState<RuleMatchType>("process");
  const [decision, setDecision] = useState<RuleDecision>("allow");
  const [pattern, setPattern] = useState("");

  // 多模态 AI 设置状态
  const [visionSettings, setVisionSettings] = useState<VisionSettingsView>({
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o",
    apiKeyConfigured: false,
    sendWindowTitle: false,
    visionEnabled: false,
    timeoutMs: 10000,
  });
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [testResult, setTestResult] = useState<{ ok: boolean; message?: string } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingVision, setIsSavingVision] = useState(false);

  useEffect(() => {
    const api = window.studyPartner;
    if (!api) return;
    void api.getVisionSettings().then((settings) => {
      setVisionSettings(settings);
    }).catch(() => {});
  }, []);

  const submitRule = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pattern.trim()) return;
    onSave({ matchType, decision, pattern, enabled: true });
    setPattern("");
  };

  const submitVisionSettings = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const api = window.studyPartner;
    if (!api) return;

    setIsSavingVision(true);
    try {
      const updated = await api.saveVisionSettings({
        baseUrl: visionSettings.baseUrl,
        model: visionSettings.model,
        apiKey: apiKeyInput.trim() ? apiKeyInput.trim() : undefined,
        sendWindowTitle: visionSettings.sendWindowTitle,
        visionEnabled: visionSettings.visionEnabled,
        timeoutMs: visionSettings.timeoutMs,
      });
      setVisionSettings(updated);
      setTestResult({ ok: true, message: "设置已安全保存" });
    } catch {
      setTestResult({ ok: false, message: "保存失败" });
    } finally {
      // 密钥无论保存成功与否都不继续留在 renderer 状态中。
      setApiKeyInput("");
      setIsSavingVision(false);
    }
  };

  const handleClearApiKey = async () => {
    const api = window.studyPartner;
    if (!api) return;
    const updated = await api.saveVisionSettings({
      baseUrl: visionSettings.baseUrl,
      model: visionSettings.model,
      sendWindowTitle: visionSettings.sendWindowTitle,
      visionEnabled: visionSettings.visionEnabled,
      timeoutMs: visionSettings.timeoutMs,
      clearApiKey: true,
    });
    setVisionSettings(updated);
    setApiKeyInput("");
    setTestResult({ ok: true, message: "API 密钥已清除" });
  };

  const handleTestConnection = async () => {
    const api = window.studyPartner;
    if (!api) return;
    setIsTesting(true);
    setTestResult(null);
    try {
      const res = await api.testVisionConnection();
      setTestResult(res);
    } catch {
      setTestResult({ ok: false, message: "连通性测试失败" });
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <main className="rules-view">
      <header className="rules-header">
        <div>
          <span className="history-eyebrow">STUDY SUPERVISION SETTINGS</span>
          <h1>督学与巡查设置</h1>
          <p>本地规则拥有最高优先级；多模态 AI 仅在规则无法判断且获得本场授权时辅助裁决。</p>
        </div>
        <button className="button button--primary" onClick={onBack} type="button">回到督学室</button>
      </header>

      <div style={{ display: "flex", gap: "12px", borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: "8px" }}>
        <button
          className={`button ${activeTab === "rules" ? "button--primary" : "button--secondary"}`}
          onClick={() => setActiveTab("rules")}
          type="button"
        >
          本地规则 ({rules.length})
        </button>
        <button
          className={`button ${activeTab === "vision" ? "button--primary" : "button--secondary"}`}
          onClick={() => setActiveTab("vision")}
          type="button"
        >
          兼容多模态 AI 配置
        </button>
      </div>

      {activeTab === "rules" ? (
        <section className="rules-layout" style={{ marginTop: "16px" }}>
          <form className="rule-editor" onSubmit={submitRule}>
            <h2>新增本地规则</h2>
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
                <option value="allow">允许学习 (白名单)</option>
                <option value="block">禁止分心 (黑名单)</option>
              </select>
            </label>
            <label>
              <span>匹配内容</span>
              <input
                maxLength={200}
                onChange={(event) => setPattern(event.target.value)}
                placeholder={matchType === "process" ? "例如：Code.exe" : "例如：高数视频"}
                required
                value={pattern}
              />
            </label>
            <div className="rule-editor__privacy">
              应用不会保存真实窗口标题；观察记录最多保存其不可逆 SHA-256 哈希。
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
              <div className="rule-list__empty">暂时没有规则。没有规则时，巡查会进入不确定流程，绝不会直接处罚。</div>
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
      ) : (
        <section className="rules-layout" style={{ marginTop: "16px" }}>
          <form className="rule-editor" onSubmit={submitVisionSettings}>
            <h2>OpenAI-Compatible 多模态接口</h2>
            <p>支持兼容 OpenAI 协议的自建或第三方大模型视觉端点。</p>

            <label>
              <span>API Base URL</span>
              <input
                onChange={(e) => setVisionSettings({ ...visionSettings, baseUrl: e.target.value })}
                placeholder="https://api.openai.com/v1"
                required
                value={visionSettings.baseUrl}
              />
            </label>

            <label>
              <span>模型名称 (Model)</span>
              <input
                onChange={(e) => setVisionSettings({ ...visionSettings, model: e.target.value })}
                placeholder="gpt-4o"
                required
                value={visionSettings.model}
              />
            </label>

            <label>
              <span>API 密钥 (API Key)</span>
              <input
                onChange={(e) => setApiKeyInput(e.target.value)}
                placeholder={visionSettings.apiKeyConfigured ? "已配置安全密钥（留空保持不变）" : "输入 sk-..."}
                type="password"
                value={apiKeyInput}
              />
            </label>

            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {visionSettings.apiKeyConfigured ? (
                <button className="button button--secondary" onClick={handleClearApiKey} type="button">
                  清除已存密钥
                </button>
              ) : null}
              <button
                className="button button--secondary"
                disabled={isTesting || !visionSettings.apiKeyConfigured}
                onClick={handleTestConnection}
                type="button"
              >
                {isTesting ? "测试中..." : "测试连接"}
              </button>
            </div>

            {testResult ? (
              <p style={{ color: testResult.ok ? "#10b981" : "#ef4444", fontSize: "13px", margin: "4px 0" }}>
                {testResult.message}
              </p>
            ) : null}

            <div className="rule-editor__privacy" style={{ lineHeight: "1.6" }}>
              <strong>安全与隐私承诺：</strong>
              <br />· 密钥使用 Windows safeStorage 加密保存在本机，绝不向渲染界面返回；
              <br />· 巡查仅在本地规则无法判断且本场开启时捕获 768px 单帧，内存即用即清；
              <br />· AI 分心判定执行 15 秒新帧二次确认机制，网络故障一律安全降级不处罚。
            </div>

            <button className="button button--primary" disabled={isSavingVision} type="submit">
              {isSavingVision ? "保存中..." : "保存视觉配置"}
            </button>
          </form>

          <section className="rule-list">
            <div className="rule-list__header">
              <h2>多模态巡查状态</h2>
            </div>
            <div style={{ padding: "16px", background: "rgba(255,255,255,0.02)", borderRadius: "8px" }}>
              <p><strong>服务状态：</strong> {visionSettings.apiKeyConfigured ? "✅ 已就绪" : "⚠️ 密钥未配置"}</p>
              <p><strong>当前模型：</strong> {visionSettings.model || "未设置"}</p>
              <p><strong>超时控制：</strong> {visionSettings.timeoutMs / 1000} 秒超时保护</p>
              <p style={{ marginTop: "12px", color: "var(--color-text-secondary, #94a3b8)", fontSize: "13px" }}>
                开启新学习会话时，先选择巡查屏幕，再勾选“启用多模态 AI 巡查辅助”即可激活此能力。
              </p>
            </div>
          </section>
        </section>
      )}
    </main>
  );
}
