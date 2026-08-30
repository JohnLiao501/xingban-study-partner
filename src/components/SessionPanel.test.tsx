import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SessionSnapshot } from "../../shared/session";
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

function renderPanel(phase: SessionSnapshot["phase"], manualInspectionControls: boolean): string {
  return renderToStaticMarkup(
    <SessionPanel
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
  });
});
