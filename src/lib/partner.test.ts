import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  resolveRelationshipLevel,
  type PartnerPackManifestV1,
} from "../../shared/partner-pack";
import { findReactionPreview, formatMediaTime, resolveAssetUrl } from "./partner";

describe("reaction preview resolution", () => {
  it("reloads media when a new pack version reuses the same asset path", () => {
    vi.stubGlobal("window", { location: { href: "file:///app/index.html" } });
    try {
      const first = resolveAssetUrl("assets/video/idle.mp4", "partner-asset://demo-guardian/", "1.0.0");
      const updated = resolveAssetUrl("assets/video/idle.mp4", "partner-asset://demo-guardian/", "1.0.1");
      expect(first).not.toBe(updated);
      expect(updated).toBe("partner-asset://demo-guardian/assets/video/idle.mp4?v=1.0.1");
    } finally { vi.unstubAllGlobals(); }
  });
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

  it("unlocks the highest eligible action and falls back to the base action", async () => {
    const manifest = JSON.parse(
      await readFile(path.join(process.cwd(), "examples", "demo-partner", "manifest.json"), "utf8"),
    ) as PartnerPackManifestV1;
    const scene = manifest.sceneVariants[0];
    const base = scene.reactions.idle_loop[0];
    scene.reactions.idle_loop.unshift({
      ...base,
      variantId: "idle-loop-trusted",
      minimumTrust: 100,
    });

    expect(findReactionPreview(manifest, scene.id, "idle_loop", 0)?.variantId)
      .toBe(base.variantId);
    expect(findReactionPreview(manifest, scene.id, "idle_loop", 100)?.variantId)
      .toBe("idle-loop-trusted");
  });

  it("resolves relationship levels from each partner's own thresholds", () => {
    const observerLevels = [
      { id: "observer-new", displayName: "初识", minimumTrust: 0 },
      { id: "observer-trusted", displayName: "信赖", minimumTrust: 100 },
    ];
    const navigatorLevels = [
      { id: "navigator-new", displayName: "启程", minimumTrust: 0 },
      { id: "navigator-trusted", displayName: "同行", minimumTrust: 30 },
    ];

    expect(resolveRelationshipLevel(observerLevels, 50)?.id).toBe("observer-new");
    expect(resolveRelationshipLevel(navigatorLevels, 50)?.id).toBe("navigator-trusted");
  });

  it("formats media time consistently", () => {
    expect(formatMediaTime(0)).toBe("00:00");
    expect(formatMediaTime(65.8)).toBe("01:05");
    expect(formatMediaTime(Number.NaN)).toBe("00:00");
  });
});
