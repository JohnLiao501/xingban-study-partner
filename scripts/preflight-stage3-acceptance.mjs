import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Stage3MockVisionServer } from "../dist-electron/electron/acceptance/mock-vision-server.js";
import { OpenAiVisionAdapter } from "../dist-electron/electron/vision/openai-vision-adapter.js";
import {
  auditStage3AcceptanceDirectory,
  removeStage3AcceptanceDirectory,
} from "../dist-electron/electron/acceptance/stage3-evidence.js";
import { STAGE3_ACCEPTANCE_PATROL_SECONDS } from "../dist-electron/shared/stage3-acceptance.js";
import { STAGE3_ACCEPTANCE_MOCK_TOKEN } from "../dist-electron/electron/acceptance/stage3-environment.js";

function emit(label, value) {
  process.stdout.write(`[Acceptance:Stage3:${label}] ${JSON.stringify(value)}\n`);
}

const acceptanceDirectory = await mkdtemp(path.join(os.tmpdir(), "xingban-stage3-acceptance-"));
const mockServer = new Stage3MockVisionServer();
let sequencePass = false;
let privacyPass = false;
let cleanupPass = false;
let mockPass = false;
let planPass = false;

try {
  const adapter = new OpenAiVisionAdapter({
    baseUrl: await mockServer.start(),
    model: "stage3-local-mock",
    getApiKey: () => STAGE3_ACCEPTANCE_MOCK_TOKEN,
  });
  const responses = [];
  for (let index = 0; index < 5; index += 1) {
    responses.push(await adapter.analyze({
      goal: "preflight",
      processName: "preflight",
      privateCommunicationPolicy: "remind",
      imageJpeg: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]),
    }));
  }
  sequencePass = responses.map((response) => `${response.label}:${response.reasonCode}`).join("|") === [
    "focused:task_related_content",
    "distracted:private_communication",
    "distracted:entertainment_content",
    "distracted:entertainment_content",
    "focused:task_related_content",
  ].join("|");
  await writeFile(
    path.join(acceptanceDirectory, "preflight-structured-summary.txt"),
    "stage 3 preflight structured summary only",
    "utf8",
  );
  planPass = STAGE3_ACCEPTANCE_PATROL_SECONDS.join(",") === "120,180,300,480,660,900,1080";
  emit("PreflightPlan", {
    patrolSeconds: STAGE3_ACCEPTANCE_PATROL_SECONDS,
    deterministic: planPass,
    sequencePass,
  });
} finally {
  const mockSummary = mockServer.getSummary();
  await mockServer.close().catch(() => {});
  mockPass = mockSummary.requestCount === 5 &&
    mockSummary.scenarioRequestCount === 5 &&
    mockSummary.remainingSteps === 0 &&
    mockSummary.invalidRequestCount === 0;
  emit("Mock", {
    ...mockSummary,
    pass: mockPass,
  });
  try {
    const privacyAudit = await auditStage3AcceptanceDirectory(acceptanceDirectory);
    privacyPass = privacyAudit.pass && privacyAudit.scannedFileCount === 1;
    emit("Privacy", privacyAudit);
  } catch {
    emit("Privacy", { pass: false });
  }
  try {
    cleanupPass = await removeStage3AcceptanceDirectory(acceptanceDirectory);
  } catch {
    cleanupPass = false;
  }
  emit("Cleanup", { removed: cleanupPass, pass: cleanupPass });
}

const pass = planPass && sequencePass && mockPass && privacyPass && cleanupPass;
emit("PreflightFinal", { pass });
process.exitCode = pass ? 0 : 1;
