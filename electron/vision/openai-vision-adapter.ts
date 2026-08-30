/**
 * 兼容 OpenAI 协议的多模态 AI 判定适配器 (OpenAiVisionAdapter)
 *
 * 规范：
 * - 严格按照 docs/05-ai-inspection-privacy.md 构建提示词与请求；
 * - 超时自动中止（默认 10000ms）；
 * - 限制响应长度，使用 validateVisionResponse 进行强类型校验；
 * - 错误信息脱敏：绝不记录 Authorization 头与 API 密钥。
 */

import type {
  VisionAdapter,
  VisionAnalysisRequest,
  VisionAnalysisResponse,
} from "./vision-adapter.js";
import { validateVisionResponse } from "../../shared/inspection.js";
import { validateVisionBaseUrl } from "../../shared/validation.js";
import type { PrivateCommunicationPolicy } from "../../shared/session.js";

export interface OpenAiVisionConfig {
  baseUrl: string;
  model: string;
  timeoutMs?: number;
  getApiKey: () => string | null;
}

function buildSystemPrompt(privateCommunicationPolicy: PrivateCommunicationPolicy): string {
  const privateCommunicationRule = privateCommunicationPolicy === "strict"
    ? "画面属于私人通讯或聊天，且与当前目标没有明确关系 -> distracted, private_communication；仍须极高把握"
    : "画面属于私人通讯或聊天 -> uncertain, private_communication；默认只提醒，绝不直接判罚";

  return `你是一个本地 AI 伴学督学判定助手。
用户的目标是专注于指定的学习或工作任务。
根据用户给出的【当前目标】、【前台应用名】、【窗口标题（若提供）】以及【当前屏幕单帧截图】，判断用户当前是否处于专注学习状态。

你必须严格输出一个纯 JSON 对象，不要输出任何 Markdown 格式或额外解释文本。
输出格式严格如下：
{
  "label": "focused" | "uncertain" | "distracted",
  "confidence": 0.0 到 1.0 之间的数值,
  "reasonCode": "task_related_content" | "entertainment_content" | "private_communication" | "insufficient_evidence"
}

判定原则：
1. 画面或应用与目标明确相关 -> "focused", "task_related_content"
2. 画面包含明确的短视频、游戏、影视流媒体或摸鱼娱乐 -> "distracted", "entertainment_content"
3. ${privateCommunicationRule}
4. 画面模糊、处于桌面、锁屏或信息不足以断定 -> "uncertain", "insufficient_evidence"
5. 浏览器、视频站、聊天软件或开发工具本身不能决定结果，必须结合当前目标和画面内容。
6. 若判定为 distracted，只有当你极其确定时才给出 >= 0.80 的置信度。若不能完全确定，置信度应低于 0.80 或直接给出 uncertain。`;
}

const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_MODEL_CONTENT_LENGTH = 4_096;

function buildChatCompletionsEndpoint(baseUrl: string): string {
  const parsed = new URL(validateVisionBaseUrl(baseUrl));
  const pathname = parsed.pathname.replace(/\/+$/, "");
  parsed.pathname = pathname.endsWith("/chat/completions")
    ? pathname
    : `${pathname}/chat/completions`;
  return parsed.toString();
}

async function readLimitedResponseText(response: Response): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_RESPONSE_BYTES) {
    throw new Error("VISION_RESPONSE_TOO_LARGE");
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > MAX_RESPONSE_BYTES) {
      throw new Error("VISION_RESPONSE_TOO_LARGE");
    }
    return text;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("VISION_RESPONSE_TOO_LARGE");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}

export class OpenAiVisionAdapter implements VisionAdapter {
  private baseUrl: string;
  private model: string;
  private timeoutMs: number;
  private readonly getApiKey: () => string | null;

  constructor(config: OpenAiVisionConfig) {
    this.baseUrl = validateVisionBaseUrl(config.baseUrl);
    this.model = config.model.trim();
    this.timeoutMs = config.timeoutMs ?? 10000;
    this.getApiKey = config.getApiKey;
  }

  updateConfig(config: Partial<Omit<OpenAiVisionConfig, "getApiKey">>): void {
    if (config.baseUrl !== undefined) this.baseUrl = validateVisionBaseUrl(config.baseUrl);
    if (config.model !== undefined) this.model = config.model.trim();
    if (config.timeoutMs !== undefined) this.timeoutMs = config.timeoutMs;
  }

  isConfigured(): boolean {
    const key = this.getApiKey();
    return Boolean(this.baseUrl && this.model && key && key.length > 0);
  }

  async analyze(request: VisionAnalysisRequest): Promise<VisionAnalysisResponse> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      throw new Error("VISION_API_KEY_MISSING");
    }

    if (!this.baseUrl || !this.model) {
      throw new Error("VISION_CONFIG_INCOMPLETE");
    }

    const endpoint = buildChatCompletionsEndpoint(this.baseUrl);

    // 将二进制 JPEG 转为 Base64（仅在构造局部请求体时保留引用）
    let base64Image = Buffer.from(request.imageJpeg).toString("base64");

    const userTextParts = [
      `【用户专注目标】: ${request.goal}`,
      `【当前前台进程】: ${request.processName}`,
    ];
    if (request.windowTitle) {
      userTextParts.push(`【当前窗口标题】: ${request.windowTitle}`);
    }

    const payload = {
      model: this.model,
      messages: [
        { role: "system", content: buildSystemPrompt(request.privateCommunicationPolicy) },
        {
          role: "user",
          content: [
            { type: "text", text: userTextParts.join("\n") },
            {
              type: "image_url",
              image_url: {
                url: `data:image/jpeg;base64,${base64Image}`,
              },
            },
          ],
        },
      ],
      max_tokens: 250,
      temperature: 0.1,
    };
    let requestBody = JSON.stringify(payload);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: requestBody,
        signal: controller.signal,
        redirect: "manual",
      });

      if (!response.ok) {
        throw new Error(`VISION_HTTP_ERROR_${response.status}`);
      }

      const responseText = await readLimitedResponseText(response);
      const data = JSON.parse(responseText) as {
        choices?: Array<{ message?: { content?: string } }>;
      };

      const rawContent = data.choices?.[0]?.message?.content;
      if (!rawContent || typeof rawContent !== "string") {
        throw new Error("VISION_EMPTY_CONTENT");
      }
      if (rawContent.length > MAX_MODEL_CONTENT_LENGTH) {
        throw new Error("VISION_MODEL_CONTENT_TOO_LARGE");
      }

      const parsed = JSON.parse(rawContent);

      return validateVisionResponse(parsed);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new Error("VISION_REQUEST_TIMEOUT");
      }
      throw err;
    } finally {
      clearTimeout(timer);
      base64Image = "";
      requestBody = "";
    }
  }

  /** 测试连通性（不传大图，只测试能否连接并识别密钥） */
  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const apiKey = this.getApiKey();
    if (!apiKey) {
      return { ok: false, message: "尚未配置 API 密钥" };
    }
    if (!this.baseUrl || !this.model) {
      return { ok: false, message: "API 地址或模型名称未配置" };
    }

    const endpoint = buildChatCompletionsEndpoint(this.baseUrl);

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 10,
        }),
        signal: controller.signal,
        redirect: "manual",
      });

      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}` };
      }

      return { ok: true, message: "连接成功" };
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        return { ok: false, message: "连接超时" };
      }
      return { ok: false, message: "网络连接失败" };
    } finally {
      clearTimeout(timer);
    }
  }

}
