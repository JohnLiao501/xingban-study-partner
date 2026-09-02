/**
 * 阶段 3 B1：2:00 允许规则与 3:00 连续禁止规则的短预演轨迹判定。
 *
 * 只消费主进程 `[Acceptance:Stage3]` 结构化事件流中的前两个 observation：
 * - 节点 1（2:00）：允许进程前台 → focused / allowed_app / local-rule，不确认偏航；
 * - 节点 2（3:00）：禁止进程连续前台 ≥ 20 秒 → distracted / blocked_app / local-rule，
 *   确认恰好一次本地规则偏航。
 *
 * 判定哲学是快速失败：任一节点与预期不符、出现第三个 observation 或任何事件
 * 形状违规，都立即给出 stop-fail，由外层 runner 结束本场，不再等待完整 25 分钟。
 * 本模块是纯逻辑，不依赖 Electron、网络或文件系统。
 */

import type { ObservationReasonCode, InspectionSource } from "../../shared/inspection.js";
import type { SessionSnapshot } from "../../shared/session.js";
import type { Stage3AcceptanceEvent } from "./stage3-recorder.js";
import { validateStage3AcceptanceEvent } from "./stage3-run-trace.js";

export type Stage3B1Decision = "continue" | "stop-pass" | "stop-fail";

export interface Stage3B1NodeExpectation {
  node: "2:00" | "3:00";
  minFocusedSecond: number;
  maxFocusedSecond: number;
  label: SessionSnapshot["lastObservation"];
  reasonCode: ObservationReasonCode;
  source: InspectionSource;
  confirmedDeviation: boolean;
  deviationCount: number;
  patrolCount: number;
}

/**
 * 固定节点期望。窗口下界即节点秒数（巡查计时到点即触发，G3-B 轨迹要求恰好
 * 120/180），上界保留少量调度余量；超出窗口说明巡查调度已经漂移，必须失败。
 */
export const STAGE3_B1_NODE_EXPECTATIONS: readonly Stage3B1NodeExpectation[] = [
  {
    node: "2:00",
    minFocusedSecond: 120,
    maxFocusedSecond: 126,
    label: "focused",
    reasonCode: "allowed_app",
    source: "local-rule",
    confirmedDeviation: false,
    deviationCount: 0,
    patrolCount: 1,
  },
  {
    node: "3:00",
    minFocusedSecond: 180,
    maxFocusedSecond: 186,
    label: "distracted",
    reasonCode: "blocked_app",
    source: "local-rule",
    confirmedDeviation: true,
    deviationCount: 1,
    patrolCount: 2,
  },
];

/** 节点不符时输出的低敏诊断：只含规则类别与本地分类原因，不含进程名或窗口标题。 */
export interface Stage3B1ClassificationDiagnostic {
  focusedSecond: number;
  processMatch: Stage3AcceptanceEvent["processMatch"];
  localVerdict: Stage3AcceptanceEvent["localVerdict"];
  localReason: Stage3AcceptanceEvent["localReason"];
}

export interface Stage3B1Failure {
  reason: "observation_mismatch" | "invalid_event";
  node: "2:00" | "3:00" | null;
  expected: Partial<Stage3B1NodeExpectation> | null;
  actual: {
    focusedSecond: number;
    label: Stage3AcceptanceEvent["label"];
    reasonCode: Stage3AcceptanceEvent["reasonCode"];
    source: Stage3AcceptanceEvent["source"];
    confirmedDeviation: boolean;
    deviationCount: number;
    patrolCount: number;
  } | null;
}

export interface Stage3B1TraceSummary {
  eventCount: number;
  observationCount: number;
  invalidEventCount: number;
  firstNodePass: boolean;
  secondNodePass: boolean;
  failure: Stage3B1Failure | null;
  diagnostics: Stage3B1ClassificationDiagnostic[];
  pass: boolean;
}

const MAX_DIAGNOSTICS = 8;

function matchesExpectation(
  event: Stage3AcceptanceEvent,
  expectation: Stage3B1NodeExpectation,
): boolean {
  return event.focusedSecond >= expectation.minFocusedSecond &&
    event.focusedSecond <= expectation.maxFocusedSecond &&
    event.label === expectation.label &&
    event.reasonCode === expectation.reasonCode &&
    event.source === expectation.source &&
    event.confirmedDeviation === expectation.confirmedDeviation &&
    event.deviationCount === expectation.deviationCount &&
    event.patrolCount === expectation.patrolCount;
}

function actualView(event: Stage3AcceptanceEvent): Stage3B1Failure["actual"] {
  return {
    focusedSecond: event.focusedSecond,
    label: event.label,
    reasonCode: event.reasonCode,
    source: event.source,
    confirmedDeviation: event.confirmedDeviation,
    deviationCount: event.deviationCount,
    patrolCount: event.patrolCount,
  };
}

export interface Stage3B1RunOutcomeInput {
  interrupted: boolean;
  failFastReason: string | null;
  traceSummary: Stage3B1TraceSummary;
  shellReady: boolean;
  setupDialogReady: boolean;
  gpuCrashCount: number;
  childExitCode: number | null;
  shutdownPass: boolean;
  processCleanupPass: boolean;
  mockRequestCount: number;
  mockInvalidRequestCount: number;
  privacyPass: boolean;
  cleanupPass: boolean;
}

/** B1 runner 的集中通过判据，防止脚本遗漏正常关停或精确计数门禁。 */
export function evaluateStage3B1RunOutcome(input: Stage3B1RunOutcomeInput): boolean {
  return !input.interrupted &&
    !input.failFastReason &&
    input.traceSummary.pass &&
    input.shellReady &&
    input.setupDialogReady &&
    input.gpuCrashCount === 0 &&
    input.childExitCode === 0 &&
    input.shutdownPass &&
    input.processCleanupPass &&
    input.mockRequestCount === 0 &&
    input.mockInvalidRequestCount === 0 &&
    input.privacyPass &&
    input.cleanupPass;
}

export class Stage3B1RunTrace {
  private readonly events: Stage3AcceptanceEvent[] = [];
  private readonly diagnostics: Stage3B1ClassificationDiagnostic[] = [];
  private invalidEventCount = 0;
  private observationCount = 0;
  private firstNodePass = false;
  private secondNodePass = false;
  private failure: Stage3B1Failure | null = null;
  private decision: Stage3B1Decision = "continue";

  /**
   * 消费一条主进程事件，返回 runner 应采取的动作。
   * 一旦返回 stop-pass / stop-fail，后续事件不再改变结论。
   */
  accept(value: unknown): Stage3B1Decision {
    if (this.decision !== "continue") return this.decision;

    const event = validateStage3AcceptanceEvent(value);
    if (!event) {
      this.invalidEventCount += 1;
      this.failure = {
        reason: "invalid_event",
        node: null,
        expected: null,
        actual: null,
      };
      this.decision = "stop-fail";
      return this.decision;
    }
    this.events.push(event);

    if (event.kind === "classification") {
      this.diagnostics.push({
        focusedSecond: event.focusedSecond,
        processMatch: event.processMatch,
        localVerdict: event.localVerdict,
        localReason: event.localReason,
      });
      if (this.diagnostics.length > MAX_DIAGNOSTICS) this.diagnostics.shift();
      return this.decision;
    }

    if (event.kind !== "observation") return this.decision;

    // 判定在两个 observation 后必然锁定（stop-pass 或 stop-fail），
    // 因此这里一定能取到期望；第三个 observation 只会到达已锁定的轨迹。
    const expectation = STAGE3_B1_NODE_EXPECTATIONS[this.observationCount];
    this.observationCount += 1;
    if (!expectation) return this.decision;

    if (!matchesExpectation(event, expectation)) {
      this.failure = {
        reason: "observation_mismatch",
        node: expectation.node,
        expected: { ...expectation },
        actual: actualView(event),
      };
      this.decision = "stop-fail";
      return this.decision;
    }

    if (expectation.node === "2:00") {
      this.firstNodePass = true;
      return this.decision;
    }
    this.secondNodePass = true;
    this.decision = "stop-pass";
    return this.decision;
  }

  summarize(): Stage3B1TraceSummary {
    const pass = this.decision === "stop-pass" &&
      this.invalidEventCount === 0 &&
      this.firstNodePass &&
      this.secondNodePass &&
      this.failure === null;
    return {
      eventCount: this.events.length,
      observationCount: this.observationCount,
      invalidEventCount: this.invalidEventCount,
      firstNodePass: this.firstNodePass,
      secondNodePass: this.secondNodePass,
      failure: this.failure,
      diagnostics: [...this.diagnostics],
      pass,
    };
  }
}
