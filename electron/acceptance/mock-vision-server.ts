import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { ObservationLabel } from "../../shared/session.js";
import type { ObservationReasonCode } from "../../shared/inspection.js";
import { STAGE3_ACCEPTANCE_MOCK_TOKEN } from "./stage3-environment.js";

const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

export type MockVisionStep =
  | {
      kind: "vision";
      label: ObservationLabel;
      confidence: number;
      reasonCode: ObservationReasonCode;
      delayMs?: number;
    }
  | { kind: "http-error"; status: 429 | 500; delayMs?: number }
  | { kind: "invalid-json"; delayMs?: number };

export const DEFAULT_STAGE3_MOCK_SCRIPT: readonly MockVisionStep[] = [
  { kind: "vision", label: "focused", confidence: 0.92, reasonCode: "task_related_content" },
  { kind: "vision", label: "distracted", confidence: 0.94, reasonCode: "private_communication" },
  { kind: "vision", label: "distracted", confidence: 0.93, reasonCode: "entertainment_content" },
  { kind: "vision", label: "distracted", confidence: 0.95, reasonCode: "entertainment_content" },
  { kind: "vision", label: "focused", confidence: 0.91, reasonCode: "task_related_content" },
] as const;

export interface MockVisionServerSummary {
  requestCount: number;
  scenarioRequestCount: number;
  consumedSteps: number;
  remainingSteps: number;
  invalidRequestCount: number;
}

function wait(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
  });
  response.end(body);
}

async function readRequestBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;
  try {
    for await (const rawChunk of request) {
      const chunk = Buffer.isBuffer(rawChunk) ? rawChunk : Buffer.from(rawChunk);
      totalBytes += chunk.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) throw new Error("MOCK_REQUEST_TOO_LARGE");
      chunks.push(chunk);
    }
    const bodyBuffer = Buffer.concat(chunks);
    let bodyText = bodyBuffer.toString("utf8");
    try {
      return JSON.parse(bodyText);
    } finally {
      bodyText = "";
      bodyBuffer.fill(0);
    }
  } finally {
    for (const chunk of chunks) chunk.fill(0);
    chunks.length = 0;
  }
}

function isConnectionProbe(payload: unknown): boolean {
  if (!payload || typeof payload !== "object") return false;
  const messages = (payload as { messages?: unknown }).messages;
  if (!Array.isArray(messages)) return false;
  return messages.some((message) => (
    message && typeof message === "object" &&
    (message as { content?: unknown }).content === "ping"
  ));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isValidScenarioPayload(payload: unknown): boolean {
  if (!isRecord(payload) || !hasExactKeys(payload, ["model", "messages", "max_tokens", "temperature"])) {
    return false;
  }
  if (
    payload.model !== "stage3-local-mock" ||
    payload.max_tokens !== 250 ||
    payload.temperature !== 0.1 ||
    !Array.isArray(payload.messages) ||
    payload.messages.length !== 2
  ) {
    return false;
  }

  const [systemMessage, userMessage] = payload.messages;
  if (
    !isRecord(systemMessage) ||
    !hasExactKeys(systemMessage, ["role", "content"]) ||
    systemMessage.role !== "system" ||
    typeof systemMessage.content !== "string" ||
    !isRecord(userMessage) ||
    !hasExactKeys(userMessage, ["role", "content"]) ||
    userMessage.role !== "user" ||
    !Array.isArray(userMessage.content) ||
    userMessage.content.length !== 2
  ) {
    return false;
  }

  const [textPart, imagePart] = userMessage.content;
  if (
    !isRecord(textPart) ||
    !hasExactKeys(textPart, ["type", "text"]) ||
    textPart.type !== "text" ||
    typeof textPart.text !== "string" ||
    !textPart.text.includes("【用户专注目标】:") ||
    !textPart.text.includes("【当前前台进程】:") ||
    textPart.text.includes("【当前窗口标题】:") ||
    !isRecord(imagePart) ||
    !hasExactKeys(imagePart, ["type", "image_url"]) ||
    imagePart.type !== "image_url" ||
    !isRecord(imagePart.image_url) ||
    !hasExactKeys(imagePart.image_url, ["url"]) ||
    typeof imagePart.image_url.url !== "string" ||
    !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(imagePart.image_url.url)
  ) {
    return false;
  }
  return true;
}

export class Stage3MockVisionServer {
  private readonly server: http.Server;
  private readonly script: MockVisionStep[];
  private requestCount = 0;
  private scenarioRequestCount = 0;
  private consumedSteps = 0;
  private invalidRequestCount = 0;
  private baseUrl: string | null = null;

  constructor(script: readonly MockVisionStep[] = DEFAULT_STAGE3_MOCK_SCRIPT) {
    this.script = script.map((step) => ({ ...step }));
    this.server = http.createServer((request, response) => {
      void this.handleRequest(request, response);
    });
  }

  async start(): Promise<string> {
    if (this.baseUrl) return this.baseUrl;
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => reject(error);
      this.server.once("error", onError);
      this.server.listen(0, "127.0.0.1", () => {
        this.server.off("error", onError);
        resolve();
      });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new Error("MOCK_SERVER_ADDRESS_INVALID");
    this.baseUrl = `http://127.0.0.1:${address.port}/v1`;
    return this.baseUrl;
  }

  getSummary(): MockVisionServerSummary {
    return {
      requestCount: this.requestCount,
      scenarioRequestCount: this.scenarioRequestCount,
      consumedSteps: this.consumedSteps,
      remainingSteps: Math.max(0, this.script.length - this.consumedSteps),
      invalidRequestCount: this.invalidRequestCount,
    };
  }

  async close(): Promise<void> {
    if (!this.server.listening) return;
    this.server.closeAllConnections();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
    this.baseUrl = null;
  }

  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    this.requestCount += 1;
    response.setHeader("x-content-type-options", "nosniff");
    if (
      request.method !== "POST" ||
      request.url !== "/v1/chat/completions" ||
      request.socket.remoteAddress !== "127.0.0.1"
    ) {
      this.invalidRequestCount += 1;
      writeJson(response, 404, { error: "not_found" });
      return;
    }
    if (request.headers.authorization !== `Bearer ${STAGE3_ACCEPTANCE_MOCK_TOKEN}`) {
      this.invalidRequestCount += 1;
      writeJson(response, 401, { error: "authorization_required" });
      return;
    }

    let payload: unknown = null;
    try {
      payload = await readRequestBody(request);
      if (isConnectionProbe(payload)) {
        if (!isRecord(payload) || payload.model !== "stage3-local-mock") {
          this.invalidRequestCount += 1;
          writeJson(response, 400, { error: "invalid_request_shape" });
          return;
        }
        writeJson(response, 200, { choices: [{ message: { content: "{}" } }] });
        return;
      }

      if (!isValidScenarioPayload(payload)) {
        this.invalidRequestCount += 1;
        writeJson(response, 400, { error: "invalid_request_shape" });
        return;
      }

      const step = this.script[this.consumedSteps];
      this.scenarioRequestCount += 1;
      if (!step) {
        writeJson(response, 500, { error: "script_exhausted" });
        return;
      }
      this.consumedSteps += 1;
      if (step.delayMs) await wait(step.delayMs);
      if (response.destroyed) return;

      if (step.kind === "http-error") {
        writeJson(response, step.status, { error: "scripted_failure" });
        return;
      }
      if (step.kind === "invalid-json") {
        response.writeHead(200, {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
        });
        response.end("{invalid-json");
        return;
      }
      writeJson(response, 200, {
        choices: [{
          message: {
            content: JSON.stringify({
              label: step.label,
              confidence: step.confidence,
              reasonCode: step.reasonCode,
            }),
          },
        }],
      });
    } catch (error) {
      this.invalidRequestCount += 1;
      const status = error instanceof Error && error.message === "MOCK_REQUEST_TOO_LARGE" ? 413 : 400;
      if (!response.headersSent) writeJson(response, status, { error: "invalid_request" });
      else response.destroy();
    } finally {
      payload = null;
    }
  }
}
