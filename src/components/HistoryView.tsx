import { useState } from "react";
import type {
  PartnerProgressSnapshot,
  SessionHistoryEntry,
} from "../../shared/session";
import type { ObservationRecord } from "../../shared/inspection";
import { Icon } from "./Icon";

interface HistoryViewProps {
  history: SessionHistoryEntry[];
  partnerName: string;
  progress: PartnerProgressSnapshot;
  levelName: string;
  onBack: () => void;
  onRefresh: () => void;
}

const PHASE_LABELS: Record<SessionHistoryEntry["phase"], string> = {
  completed: "完成",
  aborted: "放弃",
  interrupted: "中断",
};

const LABEL_NAMES: Record<ObservationRecord["label"], string> = {
  focused: "专注",
  uncertain: "不确定",
  distracted: "偏航",
};

const SOURCE_NAMES: Record<ObservationRecord["source"], string> = {
  "local-rule": "本地规则",
  "vision-api": "多模态 AI",
  fallback: "安全降级",
};

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

const OBSERVATION_TIME_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function formatMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)} 分钟`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return HISTORY_DATE_FORMATTER.format(date);
}

function formatObsTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "未知时间";
  return OBSERVATION_TIME_FORMATTER.format(date);
}

export function HistoryView({
  history,
  partnerName,
  progress,
  levelName,
  onBack,
  onRefresh,
}: HistoryViewProps) {
  const [expandedSessionId, setExpandedSessionId] = useState<string | null>(null);
  const [observationsMap, setObservationsMap] = useState<Record<string, ObservationRecord[]>>({});
  const [isLoadingObs, setIsLoadingObs] = useState(false);

  const toggleExpand = async (sessionId: string) => {
    if (expandedSessionId === sessionId) {
      setExpandedSessionId(null);
      return;
    }

    setExpandedSessionId(sessionId);
    if (!observationsMap[sessionId] && window.studyPartner) {
      setIsLoadingObs(true);
      try {
        const obs = await window.studyPartner.listSessionObservations(sessionId);
        setObservationsMap((prev) => ({ ...prev, [sessionId]: obs }));
      } catch {
        setObservationsMap((prev) => ({ ...prev, [sessionId]: [] }));
      } finally {
        setIsLoadingObs(false);
      }
    }
  };

  return (
    <main className="history-view">
      <header className="history-header">
        <div>
          <span className="history-eyebrow">LOCAL STUDY LOG</span>
          <h1>学习历史</h1>
          <p>只保存结构化结果，不保存巡查截图与原始窗口标题。</p>
        </div>
        <div className="history-header__actions">
          <button className="button button--secondary" onClick={onRefresh} type="button">刷新</button>
          <button className="button button--primary" onClick={onBack} type="button">回到督学室</button>
        </div>
      </header>

      <section className="trust-summary" aria-label="伙伴信赖">
        <div className="trust-summary__icon"><Icon name="spark" size={28} /></div>
        <div>
          <span>{partnerName}</span>
          <h2>{levelName}</h2>
          <p>信赖按伙伴独立累计</p>
        </div>
        <strong>{progress.totalTrust}</strong>
        <small>总信赖</small>
      </section>

      <section className="history-list" aria-label="会话记录">
        <div className="history-list__title">
          <h2>最近会话</h2>
          <span>{history.length} 条</span>
        </div>
        {history.length === 0 ? (
          <div className="history-empty">
            <Icon name="history" size={30} />
            <h3>还没有已结算的会话</h3>
            <p>完成、放弃或中断一场学习后，结构化摘要会出现在这里。</p>
          </div>
        ) : (
          <div className="history-rows">
            {history.map((entry) => {
              const isExpanded = expandedSessionId === entry.sessionId;
              const obsList = observationsMap[entry.sessionId] ?? [];

              return (
                <div key={entry.sessionId} style={{ display: "flex", flexDirection: "column" }}>
                  <article
                    className="history-row"
                    onClick={() => void toggleExpand(entry.sessionId)}
                    style={{ cursor: "pointer" }}
                    title="点击展开/收起本场巡查明细"
                  >
                    <div className={`history-grade history-grade--${entry.grade ?? "none"}`}>
                      {entry.grade ?? "—"}
                    </div>
                    <div className="history-row__main">
                      <h3>{entry.goal}</h3>
                      <p>{formatDate(entry.endedAt)} · {PHASE_LABELS[entry.phase]}</p>
                    </div>
                    <dl>
                      <div><dt>专注</dt><dd>{formatMinutes(entry.focusedSeconds)}</dd></div>
                      <div><dt>偏航</dt><dd>{entry.deviationCount}</dd></div>
                      <div><dt>信赖</dt><dd>+{entry.trustGained}</dd></div>
                    </dl>
                  </article>

                  {isExpanded ? (
                    <div style={{ padding: "12px 16px", background: "rgba(255,255,255,0.02)", borderBottomLeftRadius: "8px", borderBottomRightRadius: "8px", borderTop: "1px dashed rgba(255,255,255,0.06)", marginBottom: "8px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                        <span style={{ fontSize: "12px", color: "var(--color-text-secondary, #94a3b8)", fontWeight: 600 }}>
                          本场巡查判定明细（共 {obsList.length} 次）
                        </span>
                        <span style={{ fontSize: "11px", color: "#64748b" }}>
                          * 截图即用即焚，数据库仅存结构化指标
                        </span>
                      </div>

                      {isLoadingObs && !observationsMap[entry.sessionId] ? (
                        <p style={{ fontSize: "12px", color: "#94a3b8" }}>正在加载巡查明细...</p>
                      ) : obsList.length === 0 ? (
                        <p style={{ fontSize: "12px", color: "#94a3b8" }}>本场会话未记录到巡查样本或为手动快速测试。</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {obsList.map((obs) => (
                            <div
                              key={obs.id}
                              style={{
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "space-between",
                                padding: "6px 10px",
                                background: "rgba(0,0,0,0.2)",
                                borderRadius: "4px",
                                fontSize: "12px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <span style={{ color: "#94a3b8", fontFamily: "monospace" }}>
                                  {formatObsTime(obs.observedAt)}
                                </span>
                                <span
                                  style={{
                                    padding: "2px 6px",
                                    borderRadius: "3px",
                                    fontWeight: 600,
                                    fontSize: "11px",
                                    color:
                                      obs.label === "focused"
                                        ? "#10b981"
                                        : obs.label === "distracted"
                                          ? "#ef4444"
                                          : "#f59e0b",
                                    background:
                                      obs.label === "focused"
                                        ? "rgba(16,185,129,0.15)"
                                        : obs.label === "distracted"
                                          ? "rgba(239,68,68,0.15)"
                                          : "rgba(245,158,11,0.15)",
                                  }}
                                >
                                  {LABEL_NAMES[obs.label]}
                                </span>
                                <span>{obs.appName || "未知应用"}</span>
                              </div>
                              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--color-text-secondary, #94a3b8)", fontSize: "11px" }}>
                                <span>来源: {SOURCE_NAMES[obs.source]}</span>
                                <span>原因: {obs.reasonCode}</span>
                                <span>置信度: {Math.round(obs.confidence * 100)}%</span>
                                {obs.confirmedDeviation ? (
                                  <span style={{ color: "#ef4444", fontWeight: 600 }}>偏航扣除</span>
                                ) : null}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
