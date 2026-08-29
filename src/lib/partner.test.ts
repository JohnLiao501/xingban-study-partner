import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PartnerPackManifestV1 } from "../../shared/partner-pack";
import { findReactionPreview, formatMediaTime } from "./partner";

describe("reaction preview resolution", () => {
  it("resolves every reaction in the demo scene", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "examples", "demo-partner", "manifest.json"), "utf8"),
    ) as PartnerPackManifestV1;
    const scene = manifest.sceneVariants[0];

    for (const reactionKey of Object.keys(scene.reactions) as Array<keyof typeof scene.reactions>) {
      const preview = findReactionPreview(manifest, scene.id, reactionKey);
      expect(preview?.video.kind).toBe("video");
      expect(preview?.line.reactionKey).toBe(reactionKey);
    }
  });

  it("formats media time consistently", () => {
    expect(formatMediaTime(0)).toBe("00:00");
    expect(formatMediaTime(65.8)).toBe("01:05");
    expect(formatMediaTime(Number.NaN)).toBe("00:00");
  });
});
