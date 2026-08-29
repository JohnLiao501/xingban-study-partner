import type {
  PartnerProgressSnapshot,
  SessionHistoryEntry,
} from "../../shared/session";
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

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("zh-CN", {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

function formatMinutes(seconds: number): string {
  return `${Math.floor(seconds / 60)} 分钟`;
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "时间未知";
  return HISTORY_DATE_FORMATTER.format(date);
}

export function HistoryView({
  history,
  partnerName,
  progress,
  levelName,
  onBack,
  onRefresh,
}: HistoryViewProps) {
  return (
    <main className="history-view">
      <header className="history-header">
        <div>
          <span className="history-eyebrow">LOCAL STUDY LOG</span>
          <h1>学习历史</h1>
          <p>只保存结构化结果，不保存巡查截图。</p>
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
            {history.map((entry) => (
              <article className="history-row" key={entry.sessionId}>
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
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
