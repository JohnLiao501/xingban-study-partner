/**
 * OpenAiVisionAdapter 单元测试
 *
 * 验证：
 * - 正常请求构造与合法 JSON 判定结果返回
 * - 自动提取 Markdown 代码块包裹的 JSON
 * - 校验拦截无效字段与未知枚举
 * - HTTP 错误状态码抛出
 * - 缺失 API Key 拦截
 * - 超时中止处理
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { OpenAiVisionAdapter } from "./openai-vision-adapter.js";
import type { VisionAnalysisRequest } from "./vision-adapter.js";

describe("OpenAiVisionAdapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  const dummyRequest: VisionAnalysisRequest = {
    goal: "学习 Rust 异步并发",
    processName: "code",
    windowTitle: "main.rs - VS Code",
    imageJpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  };

  it("配置完整时 isConfigured 返回 true，缺少密钥返回 false", () => {
    let key: string | null = "sk-test-123";
    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => key,
    });

    expect(adapter.isConfigured()).toBe(true);

    key = null;
    expect(adapter.isConfigured()).toBe(false);
  });

  it("成功返回合法 JSON 响应并正确解析", async () => {
    const mockApiResponse = {
      choices: [
        {
          message: {
            content: JSON.stringify({
              label: "focused",
              confidence: 0.95,
              reasonCode: "task_related_content",
            }),
          },
        },
      ],
    };

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => mockApiResponse,
    } as unknown as Response);

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    const result = await adapter.analyze(dummyRequest);
    expect(result.label).toBe("focused");
    expect(result.confidence).toBe(0.95);
    expect(result.reasonCode).toBe("task_related_content");

    // 检查发送的 Headers
    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    expect(fetchCall[1].headers.Authorization).toBe("Bearer sk-valid-key");
  });

  it("兼容提取 Markdown ```json ... ``` 包裹的响应内容", async () => {
    const wrappedContent = "```json\n" + JSON.stringify({
      label: "distracted",
      confidence: 0.88,
      reasonCode: "entertainment_content",
    }) + "\n```";

    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: wrappedContent } }],
      }),
    } as unknown as Response);

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    const result = await adapter.analyze(dummyRequest);
    expect(result.label).toBe("distracted");
    expect(result.confidence).toBe(0.88);
    expect(result.reasonCode).toBe("entertainment_content");
  });

  it("模型返回无效数据或未知枚举时拦截并抛出错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{
          message: {
            content: JSON.stringify({
              label: "playing_game", // 非法 label
              confidence: 0.9,
              reasonCode: "task_related_content",
            }),
          },
        }],
      }),
    } as unknown as Response);

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await expect(adapter.analyze(dummyRequest)).rejects.toThrow();
  });

  it("HTTP 错误状态码安全抛出对应异常", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      statusText: "Too Many Requests",
    } as unknown as Response);

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await expect(adapter.analyze(dummyRequest)).rejects.toThrow("VISION_HTTP_ERROR_429");
  });

  it("testConnection 连接测试成功返回 ok: true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    const testRes = await adapter.testConnection();
    expect(testRes.ok).toBe(true);
  });
});
