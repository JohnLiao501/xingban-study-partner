import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  loadStage3AcceptanceRuntimeConfig,
  resolveAcceptanceDirectory,
  validateAcceptanceMockBaseUrl,
  validateStage3AcceptanceStart,
} from "./stage3-environment.js";

const temporaryPaths: string[] = [];

afterEach(() => {
  for (const temporaryPath of temporaryPaths.splice(0)) {
    rmSync(temporaryPath, { recursive: true, force: true });
  }
});

describe("stage 3 acceptance environment", () => {
  it("accepts only a direct randomized child of the OS temp directory", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "xingban-stage3-environment-test-"));
    temporaryPaths.push(root);
    const accepted = mkdtempSync(path.join(root, "xingban-stage3-acceptance-"));
    const outside = path.join(root, "ordinary-directory");
    mkdirSync(outside);

    expect(resolveAcceptanceDirectory(accepted, root)).toBe(accepted);
    expect(() => resolveAcceptanceDirectory(outside, root)).toThrow("ACCEPTANCE_USER_DATA_OUTSIDE_TEMP");
  });

  it("requires a loopback-only mock URL and complete 25-minute start input", () => {
    expect(validateAcceptanceMockBaseUrl("http://127.0.0.1:43123/v1"))
      .toBe("http://127.0.0.1:43123/v1");
    expect(() => validateAcceptanceMockBaseUrl("http://localhost:43123/v1"))
      .toThrow("ACCEPTANCE_MOCK_URL_INVALID");
    expect(() => validateAcceptanceMockBaseUrl("https://127.0.0.1:43123/v1"))
      .toThrow("ACCEPTANCE_MOCK_URL_INVALID");

    expect(() => validateStage3AcceptanceStart({
      partnerId: "demo-guardian",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
      captureSourceId: "screen:1:0",
      visionEnabled: true,
      sendWindowTitle: false,
      privateCommunicationPolicy: "remind",
      allowRuleIds: ["stage3-acceptance-allow"],
      blockRuleIds: ["stage3-acceptance-block"],
    })).not.toThrow();
    expect(() => validateStage3AcceptanceStart({
      partnerId: "demo-guardian",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
      visionEnabled: true,
      sendWindowTitle: false,
      privateCommunicationPolicy: "remind",
      allowRuleIds: ["stage3-acceptance-allow"],
      blockRuleIds: ["stage3-acceptance-block"],
    })).toThrow("ACCEPTANCE_SESSION_CONFIGURATION_INVALID");

    expect(() => validateStage3AcceptanceStart({
      partnerId: "demo-guardian",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
      captureSourceId: "screen:1:0",
      visionEnabled: true,
      sendWindowTitle: true,
      privateCommunicationPolicy: "remind",
      allowRuleIds: ["stage3-acceptance-allow"],
      blockRuleIds: ["stage3-acceptance-block"],
    })).toThrow("ACCEPTANCE_SESSION_CONFIGURATION_INVALID");

    expect(() => validateStage3AcceptanceStart({
      partnerId: "another-partner",
      packVersion: "1.0.0",
      sceneId: "quiet-observatory",
      goal: "acceptance",
      plannedMinutes: 25,
      captureSourceId: "screen:1:0",
      visionEnabled: true,
      sendWindowTitle: false,
      privateCommunicationPolicy: "remind",
      allowRuleIds: ["stage3-acceptance-allow"],
      blockRuleIds: ["stage3-acceptance-block"],
    })).toThrow("ACCEPTANCE_SESSION_CONFIGURATION_INVALID");
  });

  it("loads no acceptance state without the explicit switch", () => {
    expect(loadStage3AcceptanceRuntimeConfig({})).toBeNull();
  });
});
