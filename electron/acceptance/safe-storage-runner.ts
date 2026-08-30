import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { SecretStore } from "../security/secret-store.js";
import { XingbanDatabase } from "../storage/database.js";

export interface SafeStorageAcceptanceEvidence {
  outcome: "passed" | "failed" | "inconclusive";
  encryptionAvailable: boolean;
  ciphertextPersisted: boolean;
  plaintextAbsent: boolean;
  decryptedAfterReopen: boolean;
  clearedAfterReopen: boolean;
  errorCode?: string;
}

export async function runSafeStorageAcceptance(tempRoot: string): Promise<SafeStorageAcceptanceEvidence | null> {
  if (process.env.XINGBAN_SAFE_STORAGE_ACCEPTANCE !== "1") return null;

  const resolvedTempRoot = path.resolve(tempRoot);
  const acceptanceDirectory = await mkdtemp(path.join(resolvedTempRoot, "xingban-safe-storage-"));
  const resolvedAcceptanceDirectory = path.resolve(acceptanceDirectory);
  if (!resolvedAcceptanceDirectory.startsWith(`${resolvedTempRoot}${path.sep}`)) {
    throw new Error("ACCEPTANCE_TEMP_PATH_INVALID");
  }

  const databasePath = path.join(resolvedAcceptanceDirectory, "acceptance.sqlite3");
  const dummySecret = `xingban-acceptance-${randomUUID()}`;
  let database: XingbanDatabase | null = null;

  const evidence: SafeStorageAcceptanceEvidence = {
    outcome: "inconclusive",
    encryptionAvailable: false,
    ciphertextPersisted: false,
    plaintextAbsent: false,
    decryptedAfterReopen: false,
    clearedAfterReopen: false,
  };

  try {
    database = new XingbanDatabase(databasePath);
    let store = new SecretStore(database);
    evidence.encryptionAvailable = store.isAvailable();
    if (!evidence.encryptionAvailable) {
      evidence.errorCode = "SAFE_STORAGE_UNAVAILABLE";
      console.error(`[Acceptance:SafeStorage] ${JSON.stringify(evidence)}`);
      return evidence;
    }

    store.setApiKey(dummySecret);
    const rawCiphertext = database.getAppSetting("vision_api_key_encrypted");
    evidence.ciphertextPersisted = Boolean(rawCiphertext);
    evidence.plaintextAbsent = Boolean(rawCiphertext && !rawCiphertext.includes(dummySecret));
    database.close();
    database = null;

    database = new XingbanDatabase(databasePath);
    store = new SecretStore(database);
    evidence.decryptedAfterReopen = store.getApiKey() === dummySecret;
    store.clearApiKey();
    database.close();
    database = null;

    database = new XingbanDatabase(databasePath);
    store = new SecretStore(database);
    evidence.clearedAfterReopen = !store.hasApiKey() && store.getApiKey() === null;
    evidence.outcome = evidence.ciphertextPersisted &&
      evidence.plaintextAbsent &&
      evidence.decryptedAfterReopen &&
      evidence.clearedAfterReopen
      ? "passed"
      : "failed";
    console.log(`[Acceptance:SafeStorage] ${JSON.stringify(evidence)}`);
    return evidence;
  } catch (error) {
    evidence.outcome = "failed";
    evidence.errorCode = error instanceof Error ? error.name : "SAFE_STORAGE_ACCEPTANCE_FAILED";
    console.error(`[Acceptance:SafeStorage] ${JSON.stringify(evidence)}`);
    return evidence;
  } finally {
    database?.close();
    await rm(resolvedAcceptanceDirectory, { recursive: true, force: true });
  }
}
