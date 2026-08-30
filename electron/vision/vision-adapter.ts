/**
 * 多模态 AI 判定适配器接口与测试替身
 */

import type { ObservationLabel, PrivateCommunicationPolicy } from "../../shared/session.js";
import type { ObservationReasonCode } from "../../shared/inspection.js";

/** 发送给多模态模型的分析请求入参 */
export interface VisionAnalysisRequest {
  goal: string;
  processName: string;
  windowTitle?: string;
  privateCommunicationPolicy: PrivateCommunicationPolicy;
  imageJpeg: Uint8Array;
}

/** 多模态模型返回的结构化判定结果 */
export interface VisionAnalysisResponse {
  label: ObservationLabel;
  confidence: number;
  reasonCode: ObservationReasonCode;
}

/** 视觉适配器契约接口 */
export interface VisionAdapter {
  /** 发起单帧屏幕内容分析 */
  analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResponse>;

  /** 是否已配置有效的 API 连接与密钥 */
  isConfigured(): boolean;
}

/** 测试用 Fake 多模态适配器 */
export class FakeVisionAdapter implements VisionAdapter {
  private configured = true;
  private nextResponse: VisionAnalysisResponse = {
    label: "focused",
    confidence: 0.9,
    reasonCode: "task_related_content",
  };
  private responseQueue: VisionAnalysisResponse[] = [];
  private shouldFailWith: Error | null = null;
  private delayMs = 0;
  public callCount = 0;
  public lastRequest: VisionAnalysisRequest | null = null;

  setConfigured(configured: boolean): void {
    this.configured = configured;
  }

  setNextResponse(response: VisionAnalysisResponse): void {
    this.nextResponse = response;
  }

  enqueueResponse(response: VisionAnalysisResponse): void {
    this.responseQueue.push(response);
  }

  setDelay(ms: number): void {
    this.delayMs = ms;
  }

  setFailure(error: Error | null): void {
    this.shouldFailWith = error;
  }

  isConfigured(): boolean {
    return this.configured;
  }

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResponse> {
    this.callCount += 1;
    this.lastRequest = request;

    if (this.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, this.delayMs));
    }

    if (this.shouldFailWith) {
      throw this.shouldFailWith;
    }

    if (this.responseQueue.length > 0) {
      return this.responseQueue.shift()!;
    }

    return this.nextResponse;
  }
}
