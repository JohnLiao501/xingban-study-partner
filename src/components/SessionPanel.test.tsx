import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../shared/session";
import { createStage3AcceptancePlanView, type Stage3AcceptancePlanView } from "../../shared/stage3-acceptance";
import { SessionPanel } from "./SessionPanel";

function createSnapshot(phase: SessionSnapshot["phase"]): SessionSnapshot {
  return {
    sessionId: "session-ui-test",
    partnerId: "demo-partner",
    packVersion: "1.0.0",
    sceneId: "demo-scene",
    goal: "验证桌面巡查控制",
    plannedSeconds: 1_500,
    phase,
    paused: false,
    focusedSeconds: 180,
    uncertainSeconds: 0,
    distractedSeconds: 0,
    focusedStreakSeconds: 180,
    deviationCount: 0,
    patrolCount: phase === "patrolling" ? 1 : 0,
    nextPatrolAtFocusedSecond: 300,
    randomState: 1,
    recoveryPending: false,
    plannedReached: false,
    breakRemainingSeconds: 0,
    lastObservation: null,
    reactionKey: phase === "patrolling" ? "patrol_enter" : "idle_loop",
    outcome: null,
    recoveredFromCheckpoint: false,
  };
}

function renderPanel(
  phase: SessionSnapshot["phase"],
  manualInspectionControls: boolean,
  acceptancePlan?: Stage3AcceptancePlanView,
): string {
  return renderToStaticMarkup(
    <SessionPanel
      acceptancePlan={acceptancePlan}
      manualInspectionControls={manualInspectionControls}
      onCompleteFeedback={() => {}}
      onFinish={() => {}}
      onNewSession={() => {}}
      onObserve={() => {}}
      onPause={() => {}}
      onPreviewPatrol={() => {}}
      onResume={() => {}}
      onStartBreak={() => {}}
      snapshot={createSnapshot(phase)}
    />,
  );
}

describe("SessionPanel inspection controls", () => {
  it("桌面自动巡查阶段不暴露手工结果按钮", () => {
    const markup = renderPanel("patrolling", false);

    expect(markup).toContain("结果由主进程自动回写");
    expect(markup).not.toContain("明确分心");
    expect(markup).not.toContain("模拟本次巡查判断");
  });

  it("浏览器预览仍保留手工巡查模拟控件", () => {
    const markup = renderPanel("patrolling", true);

    expect(markup).toContain("模拟本次巡查判断");
    expect(markup).toContain("明确分心");
  });

  it("桌面专注阶段不显示模拟巡查入口", () => {
    const markup = renderPanel("focusing", false);

    expect(markup).toContain("桌面版巡查由主进程随机触发");
    expect(markup).not.toContain("模拟一次巡查");
    expect(markup).toContain("重新授权屏幕");
  });

  it("隔离验收模式显示固定节点提示而不冒充正式随机巡查", () => {
    const markup = renderPanel(
      "focusing",
      false,
      createStage3AcceptancePlanView("notepad", "mspaint"),
    );

    expect(markup).toContain("隔离验收 · 固定节点");
    expect(markup).toContain("连续禁止规则");
    expect(markup).toContain("正式模式仍保持随机巡查");
  });

  it("中途反馈明确告知会自动继续，不要求返回主窗口确认", () => {
    const markup = renderPanel("feedback", false);

    expect(markup).toContain("5 秒后自动继续");
    expect(markup).toContain("立即继续");
    expect(markup).not.toContain(">继续学习<");
  });
});
