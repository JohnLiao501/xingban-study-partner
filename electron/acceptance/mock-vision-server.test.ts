import { afterEach, describe, expect, it } from "vitest";
import { OpenAiVisionAdapter } from "../vision/openai-vision-adapter.js";
import { Stage3MockVisionServer, type MockVisionStep } from "./mock-vision-server.js";
import { STAGE3_ACCEPTANCE_MOCK_TOKEN } from "./stage3-environment.js";

const servers: Stage3MockVisionServer[] = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

function request() {
  return {
    goal: "not retained",
    processName: "explorer",
    privateCommunicationPolicy: "remind" as const,
    imageJpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
  };
}

describe("stage 3 loopback mock vision server", () => {
  it("replays a deterministic sequence without retaining request contents", async () => {
    const server = new Stage3MockVisionServer([
      { kind: "vision", label: "focused", confidence: 0.92, reasonCode: "task_related_content" },
      { kind: "vision", label: "distracted", confidence: 0.94, reasonCode: "private_communication" },
    ]);
    servers.push(server);
    const baseUrl = await server.start();
    const adapter = new OpenAiVisionAdapter({
      baseUrl,
      model: "stage3-local-mock",
      getApiKey: () => STAGE3_ACCEPTANCE_MOCK_TOKEN,
    });

    expect((await adapter.analyze(request())).label).toBe("focused");
    expect((await adapter.analyze(request())).reasonCode).toBe("private_communication");
    expect(server.getSummary()).toEqual({
      requestCount: 2,
      scenarioRequestCount: 2,
      consumedSteps: 2,
      remainingSteps: 0,
      invalidRequestCount: 0,
    });
    expect(JSON.stringify(server.getSummary())).not.toContain("not retained");
  });

  it.each([
    [{ kind: "http-error", status: 429 }],
    [{ kind: "http-error", status: 500 }],
    [{ kind: "invalid-json" }],
  ] as Array<[MockVisionStep]>) ("scripted failure safely rejects: %j", async (step) => {
    const server = new Stage3MockVisionServer([step]);
    servers.push(server);
    const adapter = new OpenAiVisionAdapter({
      baseUrl: await server.start(),
      model: "stage3-local-mock",
      getApiKey: () => STAGE3_ACCEPTANCE_MOCK_TOKEN,
    });
    await expect(adapter.analyze(request())).rejects.toThrow();
  });

  it("supports a delayed response so adapter timeout can be verified", async () => {
    const server = new Stage3MockVisionServer([{
      kind: "vision",
      label: "focused",
      confidence: 0.9,
      reasonCode: "task_related_content",
      delayMs: 100,
    }]);
    servers.push(server);
    const adapter = new OpenAiVisionAdapter({
      baseUrl: await server.start(),
      model: "stage3-local-mock",
      timeoutMs: 10,
      getApiKey: () => STAGE3_ACCEPTANCE_MOCK_TOKEN,
    });
    await expect(adapter.analyze(request())).rejects.toThrow("VISION_REQUEST_TIMEOUT");
  });

  it("rejects any token other than the fixed local canary without consuming a step", async () => {
    const server = new Stage3MockVisionServer([
      { kind: "vision", label: "focused", confidence: 0.92, reasonCode: "task_related_content" },
    ]);
    servers.push(server);
    const adapter = new OpenAiVisionAdapter({
      baseUrl: await server.start(),
      model: "stage3-local-mock",
      getApiKey: () => "unexpected-or-real-key",
    });

    await expect(adapter.analyze(request())).rejects.toThrow("VISION_HTTP_ERROR_401");
    expect(server.getSummary()).toEqual({
      requestCount: 1,
      scenarioRequestCount: 0,
      consumedSteps: 0,
      remainingSteps: 1,
      invalidRequestCount: 1,
    });
  });

  it("rejects a request containing a window title before consuming a scripted step", async () => {
    const server = new Stage3MockVisionServer([
      { kind: "vision", label: "focused", confidence: 0.92, reasonCode: "task_related_content" },
    ]);
    servers.push(server);
    const adapter = new OpenAiVisionAdapter({
      baseUrl: await server.start(),
      model: "stage3-local-mock",
      getApiKey: () => STAGE3_ACCEPTANCE_MOCK_TOKEN,
    });

    await expect(adapter.analyze({ ...request(), windowTitle: "must-not-leave-device" }))
      .rejects.toThrow("VISION_HTTP_ERROR_400");
    expect(server.getSummary().invalidRequestCount).toBe(1);
    expect(server.getSummary().consumedSteps).toBe(0);
  });
});
