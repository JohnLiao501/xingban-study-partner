import { useState, useEffect, type FormEvent } from "react";
import type { StartSessionInput } from "../../shared/session";
import type { CaptureSourceSummary, VisionSettingsView } from "../../shared/inspection";
import type { AppRule } from "../../shared/rules";

interface SessionSetupDialogProps {
  partnerId: string;
  packVersion: string;
  sceneId: string;
  partnerName: string;
  sceneName: string;
  onCancel: () => void;
  onStart: (input: StartSessionInput) => void;
}

export function SessionSetupDialog({
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
  const [visionSettings, setVisionSettings] = useState<VisionSettingsView | null>(null);
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [sendWindowTitle, setSendWindowTitle] = useState(false);
  const [rules, setRules] = useState<AppRule[]>([]);

  useEffect(() => {
    const api = window.studyPartner;
    if (!api) return;

    // 获取可用屏幕列表
    void api.listCaptureSources().then((list) => {
      setSources(list);
    }).catch(() => {});

    // 获取视觉设置（确认密钥是否配置）
    void api.getVisionSettings().then((settings) => {
      setVisionSettings(settings);
      setVisionEnabled(settings.visionEnabled && settings.apiKeyConfigured);
      setSendWindowTitle(settings.sendWindowTitle);
    }).catch(() => {});

    // 获取本地规则数
    void api.listAppRules().then((r) => setRules(r)).catch(() => {});
  }, []);

  const allowCount = rules.filter((r) => r.enabled && r.decision === "allow").length;
  const blockCount = rules.filter((r) => r.enabled && r.decision === "block").length;

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart({
      partnerId,
      packVersion,
      sceneId,
      goal,
      plannedMinutes,
      captureSourceId: selectedSourceId || undefined,
      visionEnabled: Boolean(selectedSourceId && visionEnabled && visionSettings?.apiKeyConfigured),
      sendWindowTitle: Boolean(selectedSourceId && visionEnabled && sendWindowTitle),
      allowRuleIds: rules.filter((r) => r.enabled && r.decision === "allow").map((r) => r.id),
      blockRuleIds: rules.filter((r) => r.enabled && r.decision === "block").map((r) => r.id),
    });
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <form aria-labelledby="session-setup-title" aria-modal="true" className="session-dialog" onSubmit={submit} role="dialog">
        <div className="session-dialog__eyebrow">新的专注航程</div>
        <h2 id="session-setup-title">准备开始学习</h2>
        <p className="session-dialog__summary">{partnerName} · {sceneName}</p>

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
          <select
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
          <small>选择屏幕后，仅当本地规则无法判断时截取 768px 单帧，不录屏不落盘</small>
        </label>

        {selectedSourceId ? (
          <div className="session-vision-options" style={{ marginTop: "8px", padding: "10px", background: "rgba(255,255,255,0.03)", borderRadius: "6px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }}>
              <input
                checked={visionEnabled}
                disabled={!visionSettings?.apiKeyConfigured}
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

            {visionEnabled && visionSettings?.apiKeyConfigured ? (
              <label style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "8px", cursor: "pointer" }}>
                <input
                  checked={sendWindowTitle}
                  onChange={(e) => setSendWindowTitle(e.target.checked)}
                  type="checkbox"
                />
                <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)" }}>
                  向 AI 发送前台窗口标题（有助于区分学习与娱乐页面，可随时关闭）
                </span>
              </label>
            ) : null}
          </div>
        ) : null}

        <div className="session-dialog__note" style={{ fontSize: "12px", marginTop: "12px" }}>
          已载入本地判定规则：{allowCount} 条允许，{blockCount} 条禁止。本地规则拥有最高优先级。
        </div>

        <div className="session-dialog__actions">
          <button className="button button--secondary" onClick={onCancel} type="button">取消</button>
          <button className="button button--primary" type="submit">开始本场</button>
        </div>
      </form>
    </div>
  );
}
