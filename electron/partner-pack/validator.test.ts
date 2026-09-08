import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PartnerPackManifestV1 } from "../../shared/partner-pack";
import { validatePackDirectory } from "./service";
import {
  compareVersions,
  isSafePackPath,
  isValidPartnerId,
  validatePartnerManifest,
} from "./validator";

const projectRoot = process.cwd();

async function readJson<T>(relativePath: string): Promise<T> {
  return JSON.parse(await readFile(path.join(projectRoot, relativePath), "utf8")) as T;
}

describe("PartnerPackManifestV1", () => {
  it("accepts the complete original demo pack", async () => {
    const result = await validatePackDirectory(
      path.join(projectRoot, "examples", "demo-partner"),
      path.join(projectRoot, "schemas", "partner-pack.v1.schema.json"),
    );
    expect(result.errors).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it("accepts two original neutral partner fixtures", async () => {
    const schema = await readJson<object>("schemas/partner-pack.v1.schema.json");
    const first = await readJson<PartnerPackManifestV1>("examples/demo-partner/manifest.json");
    const second = structuredClone(first);
    second.partnerId = "demo-navigator";
    second.displayName = "引航者一号";
    second.description = "用于多伙伴切换测试的原创中性夹具。";

    expect(validatePartnerManifest(schema, first, "0.1.0").ok).toBe(true);
    expect(validatePartnerManifest(schema, second, "0.1.0").ok).toBe(true);
  });

  it("rejects a missing required reaction", async () => {
    const schema = await readJson<object>("schemas/partner-pack.v1.schema.json");
    const manifest = await readJson<PartnerPackManifestV1>("examples/demo-partner/manifest.json");
    const candidate = structuredClone(manifest) as PartnerPackManifestV1 & {
      sceneVariants: Array<PartnerPackManifestV1["sceneVariants"][number] & {
        reactions: Partial<PartnerPackManifestV1["sceneVariants"][number]["reactions"]>;
      }>;
    };
    delete candidate.sceneVariants[0].reactions.idle_loop;
    const result = validatePartnerManifest(schema, candidate, "0.1.0");
    expect(result.ok).toBe(false);
    expect(result.errors.some((error) => error.includes("idle_loop"))).toBe(true);
  });

  it("rejects traversal paths before file access", async () => {
    const schema = await readJson<object>("schemas/partner-pack.v1.schema.json");
    const manifest = await readJson<PartnerPackManifestV1>("examples/demo-partner/manifest.json");
    const candidate = structuredClone(manifest);
    candidate.mediaAssets[0].filePath = "../escape.webp";
    const result = validatePartnerManifest(schema, candidate, "0.1.0");
    expect(result.ok).toBe(false);
  });

  it("rejects redistributable private fan packs", async () => {
    const schema = await readJson<object>("schemas/partner-pack.v1.schema.json");
    const manifest = await readJson<PartnerPackManifestV1>("examples/demo-partner/manifest.json");
    const candidate = structuredClone(manifest);
    candidate.sourceType = "private-fan";
    candidate.distribution = "redistributable";
    const result = validatePartnerManifest(schema, candidate, "0.1.0");
    expect(result.ok).toBe(false);
  });
});

describe("pack path and version guards", () => {
  it.each([
    ["assets/video/idle-loop.mp4", true],
    ["../outside.mp4", false],
    ["C:/outside.mp4", false],
    ["assets\\outside.mp4", false],
  ])("classifies %s", (filePath, expected) => {
    expect(isSafePackPath(filePath)).toBe(expected);
  });

  it.each([
    ["demo-guardian", true],
    ["partner-2", true],
    ["demo.guardian", false],
    ["../guardian", false],
    ["Guardian", false],
    ["a".repeat(81), false],
  ])("validates partner id %s", (partnerId, expected) => {
    expect(isValidPartnerId(partnerId)).toBe(expected);
  });

  it("compares stable three-part versions", () => {
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "1.0.0")).toBeLessThan(0);
  });
});
