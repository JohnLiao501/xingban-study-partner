import { useState, useEffect } from "react";
import {
  remainingDeviationAllowance,
  remainingFocusSeconds,
} from "../../shared/session-engine";
import type { ObservationLabel, SessionFinishMode, SessionSnapshot } from "../../shared/session";
import type { CaptureStatus } from "../../shared/inspection";

interface SessionPanelProps {
  snapshot: SessionSnapshot;
  manualInspectionControls: boolean;
  onCompleteFeedback: () => void;
  onFinish: (mode: SessionFinishMode) => void;
  onNewSession: () => void;
  onObserve: (label: ObservationLabel) => void;
  onPause: () => void;
  onPreviewPatrol: () => void;
  onResume: () => void;
  onStartBreak: () => void;
}

const PHASE_LABELS: Record<SessionSnapshot["phase"], string> = {
  preparing: "准备中",
  focusing: "专注中",
  patrolling: "正在巡查",
  feedback: "伙伴反馈",
  break: "休息中",
  completed: "已完成",
  aborted: "已放弃",
  interrupted: "已中断",
};

function formatDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function SessionPanel({
  snapshot,
  manualInspectionControls,
  onCompleteFeedback,
  onFinish,
  onNewSession,
  onObserve,
  onPause,
  onPreviewPatrol,
  onResume,
  onStartBreak,
}: SessionPanelProps) {
  const allowance = remainingDeviationAllowance(snapshot);
  const remaining = snapshot.phase === "break"
    ? snapshot.breakRemainingSeconds
    : remainingFocusSeconds(snapshot);
  const progress = Math.min(100, snapshot.focusedSeconds / snapshot.plannedSeconds * 100);
  const isTerminal = Boolean(snapshot.outcome);

  const [captureStatus, setCaptureStatus] = useState<CaptureStatus>("inactive");

  useEffect(() => {
    const api = window.studyPartner;
    if (!api?.onCaptureStatusChanged) return;
    return api.onCaptureStatusChanged((status) => {
      setCaptureStatus(status);
    });
  }, []);

  const handleStopCapture = () => {
    void window.studyPartner?.stopCapture();
  };

  return (
    <aside className="session-panel" aria-label="当前学习会话">
      <header className="session-panel__header">
        <div>
          <span className="session-kicker">本次学习</span>
          <h2>{snapshot.goal}</h2>
        </div>
        <span className={`phase-badge phase-badge--${snapshot.phase}`}>
          {snapshot.paused ? "已暂停" : PHASE_LABELS[snapshot.phase]}
        </span>
      </header>

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "6px 12px", background: "rgba(255,255,255,0.03)", borderRadius: "6px", fontSize: "12px" }}>
        <span>
          🛡️ 本地探针生效中
          {captureStatus === "active" ? (
            <span style={{ marginLeft: "8px", color: "#10b981" }}>● 屏幕巡查开启</span>
          ) : (
            <span style={{ marginLeft: "8px", color: "var(--color-text-secondary, #94a3b8)" }}>○ 仅本地规则</span>
          )}
        </span>
        {captureStatus === "active" ? (
          <button
            onClick={handleStopCapture}
            style={{ background: "transparent", border: "1px solid rgba(239, 68, 68, 0.4)", color: "#ef4444", borderRadius: "4px", padding: "2px 8px", cursor: "pointer", fontSize: "11px" }}
            title="关闭屏幕抓取，保留本地规则继续伴学"
            type="button"
          >
            停止屏幕共享
          </button>
        ) : null}
      </div>

      {snapshot.recoveredFromCheckpoint ? (
        <div className="session-recovery-banner" role="status">
          已从本地检查点恢复并暂停。确认目标后再继续计时。
        </div>
      ) : null}

      <section className="session-timer" aria-label="剩余时间">
        <span>{snapshot.phase === "break" ? "休息剩余" : "专注剩余"}</span>
        <strong>{formatDuration(remaining)}</strong>
        <div className="session-progress" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>
      </section>

      <section className="deviation-card">
        <div>
          <span>偏航额度</span>
          <strong>{allowance} / 3</strong>
        </div>
        <div className="deviation-pips" aria-label={`剩余偏航额度 ${allowance}`}>
          {[0, 1, 2].map((index) => (
            <span className={index < allowance ? "deviation-pip deviation-pip--available" : "deviation-pip"} key={index} />
          ))}
        </div>
      </section>

      <dl className="session-metrics">
        <div><dt>有效专注</dt><dd>{formatDuration(snapshot.focusedSeconds)}</dd></div>
        <div><dt>巡查次数</dt><dd>{snapshot.patrolCount}</dd></div>
      </dl>

      <div className="session-panel__controls">
        {isTerminal && snapshot.outcome ? (
          <div className="session-result" role="status">
            <span>本场评价</span>
            <strong>{snapshot.outcome.grade ?? "—"}</strong>
            <p>完成率 {Math.round(snapshot.outcome.completionRatio * 100)}% · 信赖 +{snapshot.outcome.trustGained}</p>
            <button className="button button--primary" onClick={onNewSession} type="button">开始新一场</button>
          </div>
        ) : snapshot.phase === "patrolling" && manualInspectionControls ? (
          <div className="inspection-choice">
            <p>模拟本次巡查判断</p>
            <button onClick={() => onObserve("focused")} type="button">专注</button>
            <button onClick={() => onObserve("uncertain")} type="button">不确定</button>
            <button className="inspection-choice__danger" onClick={() => onObserve("distracted")} type="button">明确分心</button>
          </div>
        ) : snapshot.phase === "patrolling" ? (
          <div className="inspection-choice inspection-choice--automatic" role="status">
            <p>正在执行本地规则与可选 AI 巡查…</p>
            <small>结果由主进程自动回写；不确定结果不会处罚。</small>
          </div>
        ) : snapshot.phase === "feedback" && snapshot.plannedReached ? (
          <div className="session-actions-stack">
            <p>计划时间已完成。可以休息五分钟，或直接结算。</p>
            <button className="button button--primary" onClick={onStartBreak} type="button">开始休息</button>
            <button className="button button--secondary" onClick={() => onFinish("completed")} type="button">直接结算</button>
          </div>
        ) : snapshot.phase === "feedback" ? (
          <div className="session-actions-stack">
            <p>{snapshot.reactionKey === "recovery" ? "已经重新稳定下来，继续保持。" : "反馈已记录，会话仍会继续。"}</p>
            <button className="button button--primary" onClick={onCompleteFeedback} type="button">继续学习</button>
          </div>
        ) : snapshot.phase === "break" ? (
          <div className="session-actions-stack">
            <p>休息期间不巡查，也不累计有效专注。</p>
            <button className="button button--secondary" onClick={() => onFinish("completed")} type="button">结束休息并结算</button>
          </div>
        ) : (
          <div className="session-actions-stack">
            <button className="button button--primary" onClick={snapshot.paused ? onResume : onPause} type="button">
              {snapshot.paused ? "继续计时" : "暂停计时"}
            </button>
            {manualInspectionControls ? (
              <button className="button button--secondary" disabled={snapshot.paused} onClick={onPreviewPatrol} type="button">模拟一次巡查</button>
            ) : null}
            <div className="session-secondary-actions">
              <button onClick={() => onFinish("completed")} type="button">提前完成</button>
              <button className="text-danger" onClick={() => onFinish("aborted")} type="button">放弃本场</button>
            </div>
            <small>
              {manualInspectionControls
                ? "模拟巡查会快进至开工后 2 分钟，仅用于浏览器预览。"
                : "桌面版巡查由主进程随机触发，本地规则拥有最高优先级。"}
            </small>
          </div>
        )}
      </div>
    </aside>
  );
}
