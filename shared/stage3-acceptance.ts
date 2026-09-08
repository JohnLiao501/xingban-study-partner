import type { CaptureStatus } from "./inspection.js";
import type { SessionPhase, SessionSnapshot } from "./session.js";

export const STAGE3_ACCEPTANCE_PATROL_SECONDS = [
  120,
  180,
  300,
  480,
  660,
  900,
  1080,
] as const;

export const STAGE3_ACCEPTANCE_SEED = 0x5a17_2026;

export const STAGE3_ACCEPTANCE_RULE_IDS = {
  allow: "stage3-acceptance-allow",
  block: "stage3-acceptance-block",
} as const;

export interface Stage3AcceptancePlanView {
  enabled: true;
  plannedMinutes: 25;
  allowProcessName: string;
  blockProcessName: string;
  patrolSeconds: number[];
}

export interface Stage3AcceptanceInstruction {
  title: string;
  action: string;
  nextPatrolSecond: number | null;
}

export function createStage3AcceptancePlanView(
  allowProcessName: string,
  blockProcessName: string,
): Stage3AcceptancePlanView {
  return {
    enabled: true,
    plannedMinutes: 25,
    allowProcessName,
    blockProcessName,
    patrolSeconds: [...STAGE3_ACCEPTANCE_PATROL_SECONDS],
  };
}

export function applyStage3AcceptancePatrolSchedule(
  snapshot: SessionSnapshot,
  patrolSeconds: readonly number[] = STAGE3_ACCEPTANCE_PATROL_SECONDS,
): SessionSnapshot {
  // 按已经实际进入的巡查次数推进，而不是只看 focusedSeconds。
  // 这样恢复反馈恰好落在节点秒数时不会把尚未执行的节点静默跳过。
  const nextPatrolSecond = patrolSeconds[snapshot.patrolCount]
    ?? snapshot.plannedSeconds + 1;
  if (snapshot.nextPatrolAtFocusedSecond === nextPatrolSecond) return snapshot;
  return { ...snapshot, nextPatrolAtFocusedSecond: nextPatrolSecond };
}

function nextPatrolSecond(plan: Stage3AcceptancePlanView, patrolCount: number): number | null {
  return plan.patrolSeconds[patrolCount] ?? null;
}

export function getStage3AcceptanceInstruction(
  plan: Stage3AcceptancePlanView,
  focusedSeconds: number,
  patrolCount: number,
  phase: SessionPhase,
  paused: boolean,
  captureStatus: CaptureStatus,
): Stage3AcceptanceInstruction {
  const next = nextPatrolSecond(plan, patrolCount);

  if (phase === "completed") {
    return { title: "25 分钟场已结算", action: "从托盘退出，等待自动证据检查与临时目录清理。", nextPatrolSecond: null };
  }
  if (phase === "aborted" || phase === "interrupted") {
    return { title: "验收场未完成", action: "退出后会保留低敏失败摘要；不要把本场记为通过。", nextPatrolSecond: null };
  }
  if (paused) {
    return { title: "暂停计时检查", action: "确认计时不增长后点击“继续计时”。", nextPatrolSecond: next };
  }
  if (phase === "patrolling") {
    return { title: "正在执行固定巡查节点", action: "保持当前前台应用不变，等待本地规则或 mock AI 返回。", nextPatrolSecond: next };
  }
  if (phase === "feedback") {
    return { title: "本节点结果已写入", action: "中途结果会在 5 秒后自动收起并继续计时；计划时长到达后再回到主窗结算。", nextPatrolSecond: next };
  }
  if (phase === "break") {
    return { title: "休息阶段", action: "本次 25 分钟场无需额外延长；可以结束休息并结算。", nextPatrolSecond: null };
  }

  if (focusedSeconds < 130) {
    return {
      title: "0～2:10：允许规则",
      action: `让 ${plan.allowProcessName} 保持前台；2:00 节点应为 focused，且不调用截图或 AI。`,
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 210) {
    return {
      title: "2:10～3:30：连续禁止规则",
      action: `尽快切到 ${plan.blockProcessName} 并保持至少 20 秒；3:00 节点应只记一次本地规则偏航。`,
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 450) {
    return {
      title: "3.5～7.5 分钟：AI focused",
      action: "切到不匹配允许/禁止规则的窗口；5:00 节点由本机 mock AI 返回 focused。",
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 630) {
    return {
      title: "7.5～10.5 分钟：私人通讯提醒",
      action: "保持未命中规则的窗口；8:00 节点模拟 private_communication，必须 uncertain 且不扣偏航。",
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 840) {
    return {
      title: "10.5～14 分钟：AI 两帧确认",
      action: "保持同一未命中规则的窗口；11:00 首帧与 15 秒后新帧都高置信分心，第二帧后才记偏航。",
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 960) {
    return {
      title: "14～16 分钟：停止共享",
      action: captureStatus === "active"
        ? "现在从托盘或本面板停止屏幕共享；15:00 节点必须安全降级且不处罚。"
        : "共享已停止；保持未知窗口到 15:00 节点，确认不再产生新帧。",
      nextPatrolSecond: next,
    };
  }
  if (focusedSeconds < 1080) {
    return {
      title: "16～18 分钟：重新授权与暂停恢复",
      action: captureStatus === "active"
        ? "共享已重新建立；暂停一次，确认计时不增长，再继续计时。随后保持未命中规则的窗口，等待 18:00 的 mock AI 巡查。"
        : "点击“重新授权屏幕”，由你再次加载并选择同一屏幕；随后暂停并恢复一次。",
      nextPatrolSecond: next,
    };
  }
  return {
    title: "18～25 分钟：稳定完成",
    action: "保持未命中允许/禁止规则的窗口；18:00 节点由本机 mock AI 返回 focused，验证重新授权后可取帧，之后完成 25 分钟并直接结算。",
    nextPatrolSecond: next,
  };
}
