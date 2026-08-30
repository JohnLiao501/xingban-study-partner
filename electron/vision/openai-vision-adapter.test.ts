/**
 * OpenAiVisionAdapter 单元测试
 *
 * 验证：
 * - 正常请求构造与合法 JSON 判定结果返回
 * - 拒绝 Markdown 代码块，只接受纯 JSON
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
    privateCommunicationPolicy: "remind",
    imageJpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  };

  function apiResponse(content: string, init?: ResponseInit): Response {
    return new Response(JSON.stringify({
      choices: [{ message: { content } }],
    }), init);
  }

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

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(mockApiResponse), { status: 200 }),
    );

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
    expect(fetchCall[1].redirect).toBe("manual");
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toContain("默认只提醒，绝不直接判罚");
  });

  it("严格私人通讯策略只改变提示口径，不绕过主进程二次确认", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(apiResponse(JSON.stringify({
      label: "distracted",
      confidence: 0.9,
      reasonCode: "private_communication",
    })));
    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await adapter.analyze({ ...dummyRequest, privateCommunicationPolicy: "strict" });

    const fetchCall = (globalThis.fetch as any).mock.calls[0];
    const body = JSON.parse(fetchCall[1].body);
    expect(body.messages[0].content).toContain("与当前目标没有明确关系");
    expect(body.messages[0].content).not.toContain("allowed_app");
  });

  it("拒绝 Markdown 代码块包裹的模型响应", async () => {
    const wrappedContent = "```json\n" + JSON.stringify({
      label: "distracted",
      confidence: 0.88,
      reasonCode: "entertainment_content",
    }) + "\n```";

    globalThis.fetch = vi.fn().mockResolvedValue(apiResponse(wrappedContent));

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await expect(adapter.analyze(dummyRequest)).rejects.toThrow();
  });

  it("模型返回无效数据或未知枚举时拦截并抛出错误", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(apiResponse(JSON.stringify({
      label: "playing_game",
      confidence: 0.9,
      reasonCode: "task_related_content",
    })));

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await expect(adapter.analyze(dummyRequest)).rejects.toThrow();
  });

  it("HTTP 错误状态码安全抛出对应异常", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, { status: 429 }));

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    await expect(adapter.analyze(dummyRequest)).rejects.toThrow("VISION_HTTP_ERROR_429");
  });

  it("testConnection 连接测试成功返回 ok: true", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));

    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });

    const testRes = await adapter.testConnection();
    expect(testRes.ok).toBe(true);
  });

  it("拒绝远程 HTTP、URL 凭据、查询参数与片段", () => {
    const make = (baseUrl: string) => new OpenAiVisionAdapter({
      baseUrl,
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });
    expect(() => make("http://example.com/v1")).toThrow();
    expect(() => make("https://user:pass@example.com/v1")).toThrow();
    expect(() => make("https://example.com/v1?tenant=1")).toThrow();
    expect(() => make("https://example.com/v1#fragment")).toThrow();
    expect(() => make("http://127.0.0.1:8080/v1")).not.toThrow();
  });

  it("响应声明长度超过 64 KiB 时拒绝解析", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response("{}", {
      status: 200,
      headers: { "content-length": String(65 * 1024) },
    }));
    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });
    await expect(adapter.analyze(dummyRequest)).rejects.toThrow("VISION_RESPONSE_TOO_LARGE");
  });

  it("3xx 不自动跟随，按 HTTP 错误安全失败", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(null, {
      status: 302,
      headers: { location: "https://other.example/v1/chat/completions" },
    }));
    const adapter = new OpenAiVisionAdapter({
      baseUrl: "https://api.openai.com/v1",
      model: "gpt-4o",
      getApiKey: () => "sk-valid-key",
    });
    await expect(adapter.analyze(dummyRequest)).rejects.toThrow("VISION_HTTP_ERROR_302");
  });
});
