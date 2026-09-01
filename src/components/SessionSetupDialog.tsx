import { useState, useEffect, type FormEvent } from "react";
import {
  DEFAULT_PRIVATE_COMMUNICATION_POLICY,
  type PrivateCommunicationPolicy,
  type StartSessionInput,
} from "../../shared/session";
import type { CaptureSourceSummary, VisionSettingsView } from "../../shared/inspection";
import type { AppRule } from "../../shared/rules";
import {
  STAGE3_ACCEPTANCE_RULE_IDS,
  type Stage3AcceptancePlanView,
} from "../../shared/stage3-acceptance";

interface SessionSetupDialogProps {
  acceptancePlan?: Stage3AcceptancePlanView;
  partnerId: string;
  packVersion: string;
  sceneId: string;
  partnerName: string;
  sceneName: string;
  onCancel: () => void;
  onStart: (input: StartSessionInput) => void;
}

export function SessionSetupDialog({
  acceptancePlan,
  partnerId,
  packVersion,
  sceneId,
  partnerName,
  sceneName,
  onCancel,
  onStart,
}: SessionSetupDialogProps) {
  const [goal, setGoal] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState(25);
  const [sources, setSources] = useState<CaptureSourceSummary[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [sourcesLoaded, setSourcesLoaded] = useState(false);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [sourceLoadError, setSourceLoadError] = useState<string>();
  const [visionSettings, setVisionSettings] = useState<VisionSettingsView | null>(null);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [sendWindowTitle, setSendWindowTitle] = useState(false);
  const [privateCommunicationPolicy, setPrivateCommunicationPolicy] =
    useState<PrivateCommunicationPolicy>(DEFAULT_PRIVATE_COMMUNICATION_POLICY);
  const [rules, setRules] = useState<AppRule[]>([]);
  const [rulesLoaded, setRulesLoaded] = useState(false);

  useEffect(() => {
    const api = window.studyPartner;
    if (!api) return;

    // 获取视觉设置（确认密钥是否配置）
    void api.getVisionSettings().then((settings) => {
      setVisionSettings(settings);
      setVisionEnabled(settings.visionEnabled && settings.apiKeyConfigured);
      setSendWindowTitle(acceptancePlan ? false : settings.sendWindowTitle);
    }).catch(() => {});

    // 获取本地规则数
    void api.listAppRules()
      .then((r) => setRules(r))
      .catch(() => setRules([]))
      .finally(() => setRulesLoaded(true));
  }, [acceptancePlan]);

  const allowCount = rules.filter((r) => r.enabled && r.decision === "allow").length;
  const blockCount = rules.filter((r) => r.enabled && r.decision === "block").length;
  const acceptanceReady = !acceptancePlan || Boolean(
    selectedSourceId &&
    visionSettings?.apiKeyConfigured &&
    rulesLoaded &&
    rules.some((rule) => (
      rule.id === STAGE3_ACCEPTANCE_RULE_IDS.allow &&
      rule.enabled &&
      rule.matchType === "process" &&
      rule.decision === "allow" &&
      rule.pattern === acceptancePlan.allowProcessName
    )) &&
    rules.some((rule) => (
      rule.id === STAGE3_ACCEPTANCE_RULE_IDS.block &&
      rule.enabled &&
      rule.matchType === "process" &&
      rule.decision === "block" &&
      rule.pattern === acceptancePlan.blockProcessName
    )),
  );

  const loadCaptureSources = async () => {
    const api = window.studyPartner;
    if (!api || sourcesLoading) return;

    setSourcesLoading(true);
    setSourceLoadError(undefined);
    try {
      const list = await api.listCaptureSources();
      setSources(list);
      setSourcesLoaded(true);
      setSelectedSourceId((current) => list.some((source) => source.id === current) ? current : "");
      if (list.length === 0) setSourceLoadError("未发现可用显示器，可稍后重试");
    } catch {
      setSources([]);
      setSourcesLoaded(true);
      setSelectedSourceId("");
      setSourceLoadError("读取屏幕列表失败；本场仍可仅使用本地规则");
    } finally {
      setSourcesLoading(false);
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart({
      partnerId,
      packVersion,
      sceneId,
      goal,
      plannedMinutes,
      captureSourceId: selectedSourceId || undefined,
      visionEnabled: Boolean(selectedSourceId && (acceptancePlan
        ? true
        : visionEnabled && visionSettings?.apiKeyConfigured)),
      sendWindowTitle: Boolean(!acceptancePlan && selectedSourceId && visionEnabled && sendWindowTitle),
      privateCommunicationPolicy: acceptancePlan ? DEFAULT_PRIVATE_COMMUNICATION_POLICY : privateCommunicationPolicy,
      allowRuleIds: rules.filter((r) => r.enabled && r.decision === "allow").map((r) => r.id),
      blockRuleIds: rules.filter((r) => r.enabled && r.decision === "block").map((r) => r.id),
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <form aria-labelledby="session-setup-title" aria-modal="true" className="session-dialog" onSubmit={submit} role="dialog">
        <div className="session-dialog__body">
          <div className="session-dialog__eyebrow">新的专注航程</div>
          <h2 id="session-setup-title">准备开始学习</h2>
          <p className="session-dialog__summary">{partnerName} · {sceneName}</p>

          {acceptancePlan ? (
            <div className="acceptance-setup-note" role="status">
              <strong>阶段 3 隔离验收模式</strong>
              <span>本场固定为 25 分钟；允许进程 {acceptancePlan.allowProcessName}，禁止进程 {acceptancePlan.blockProcessName}。</span>
              <small>必须由你主动加载并选择屏幕；AI 仅连接 127.0.0.1 本机脚本，不使用真实密钥。</small>
            </div>
          ) : null}

          <label className="session-field">
            <span>本次目标</span>
            <input
              autoFocus
              maxLength={500}
              minLength={1}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="例如：完成高数错题复盘"
              required
              value={goal}
            />
            <small>{goal.length}/500</small>
          </label>

          <label className="session-field">
            <span>计划时长</span>
            <div className="duration-input">
              <input
                aria-label="计划时长（分钟）"
                disabled={Boolean(acceptancePlan)}
                max={180}
                min={10}
                onChange={(event) => setPlannedMinutes(Number(event.target.value))}
                required
                step={5}
                type="number"
                value={plannedMinutes}
              />
              <span>分钟</span>
            </div>
            <small>10～180 分钟；默认 25 分钟</small>
          </label>

          <label className="session-field">
            <span>巡查屏幕选择</span>
            <div className="capture-source-picker">
              <select
                disabled={sourcesLoading || !sourcesLoaded}
                onChange={(event) => setSelectedSourceId(event.target.value)}
                value={selectedSourceId}
              >
                <option value="">不共享屏幕（仅通过本地规则与前台应用判断）</option>
                {sources.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || `屏幕 ${s.id}`}
                  </option>
                ))}
              </select>
              <button
                className="button button--secondary"
                disabled={!window.studyPartner || sourcesLoading}
                onClick={() => void loadCaptureSources()}
                type="button"
              >
                {sourcesLoading ? "正在读取…" : sourcesLoaded ? "刷新列表" : "加载可用屏幕"}
              </button>
            </div>
            <small className={sourceLoadError ? "session-field__error" : undefined} role="status">
              {sourceLoadError
                ?? (sourcesLoaded
                  ? "选择屏幕后，仅当本地规则无法判断时截取 768px 单帧，不录屏不落盘"
                  : "仅在你主动加载后读取屏幕列表；不加载则只使用本地规则")}
            </small>
          </label>

          {selectedSourceId ? (
            <div className="session-vision-options" style={{ marginTop: "8px", padding: "10px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
                <input
                  checked={acceptancePlan ? true : visionEnabled}
                  disabled={Boolean(acceptancePlan) || !visionSettings?.apiKeyConfigured}
                  onChange={(e) => setVisionEnabled(e.target.checked)}
                  type="checkbox"
                />
                <span>启用多模态 AI 巡查辅助</span>
              </label>
              {!visionSettings?.apiKeyConfigured ? (
                <small style={{ color: "#f59e0b", display: "block", marginTop: "4px" }}>
                  * 尚未配置 API 密钥，可在设置面板中配置
                </small>
              ) : null}

              {(acceptancePlan || visionEnabled) && visionSettings?.apiKeyConfigured ? (
                <div className="session-vision-options__details">
                  {acceptancePlan ? (
                    <small>隔离验收硬性禁止发送窗口标题；本机 mock 只接收目标、进程名与单帧。</small>
                  ) : (
                    <label className="session-vision-checkbox">
                      <input
                        checked={sendWindowTitle}
                        onChange={(e) => setSendWindowTitle(e.target.checked)}
                        type="checkbox"
                      />
                      <span>向 AI 发送前台窗口标题（有助于区分学习与娱乐页面）</span>
                    </label>
                  )}
                  <label className="session-policy-field">
                    <span>私人通讯处理</span>
                    <select
                      disabled={Boolean(acceptancePlan)}
                      onChange={(event) => setPrivateCommunicationPolicy(event.target.value as PrivateCommunicationPolicy)}
                      value={acceptancePlan ? DEFAULT_PRIVATE_COMMUNICATION_POLICY : privateCommunicationPolicy}
                    >
                      <option value="remind">温和提醒（默认，不扣偏航）</option>
                      <option value="strict">严格判定（仍需 15 秒二次确认）</option>
                    </select>
                  </label>
                  <small>聊天软件不会因应用名称被一刀切；AI 必须结合本场目标和画面内容。</small>
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="session-dialog__note" style={{ fontSize: "12px", marginTop: "12px" }}>
            已载入本地判定规则：{allowCount} 条允许，{blockCount} 条禁止。本地规则拥有最高优先级。
            <br />私人通讯默认仅温和提醒，不消耗偏航；启用 AI 后可为本场切换严格模式。
          </div>
        </div>

        <div className="session-dialog__actions">
          <button className="button button--secondary" onClick={onCancel} type="button">取消</button>
          <button className="button button--primary" disabled={!acceptanceReady} type="submit">
            {acceptancePlan && !acceptanceReady ? "等待验收配置就绪" : "开始本场"}
          </button>
        </div>
      </form>
    </div>
  );
}
