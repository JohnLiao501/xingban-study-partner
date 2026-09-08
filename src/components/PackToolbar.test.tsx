import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InstalledPartnerSummary, PartnerPackManifestV1 } from "../../shared/partner-pack";
import { PackToolbar } from "./PackToolbar";

const manifest = JSON.parse(
  readFileSync(new URL("../../examples/demo-partner/manifest.json", import.meta.url), "utf8"),
) as PartnerPackManifestV1;
manifest.sceneVariants.push({
  ...structuredClone(manifest.sceneVariants[0]),
  id: "morning-library",
  displayName: "晨光图书室",
});

const partners: InstalledPartnerSummary[] = [
  {
    partnerId: manifest.partnerId,
    packVersion: manifest.packVersion,
    displayName: manifest.displayName,
    description: manifest.description,
    sourceType: "original",
    distribution: "redistributable",
    active: true,
  },
  {
    partnerId: "demo-navigator",
    packVersion: "1.0.0",
    displayName: "引航者一号",
    description: "原创中性测试伙伴",
    sourceType: "original",
    distribution: "redistributable",
    active: false,
  },
];

function render(sessionActive: boolean): string {
  return renderToStaticMarkup(
    <PackToolbar
      desktopRuntime
      installedPartners={partners}
      manifest={manifest}
      onImport={() => {}}
      onPartnerChange={() => {}}
      onSceneChange={() => {}}
      onStart={() => {}}
      sceneId={manifest.sceneVariants[0].id}
      sessionActive={sessionActive}
    />,
  );
}

describe("PackToolbar multi-partner controls", () => {
  it("lists two neutral partners and both scenes", () => {
    const markup = render(false);
    expect(markup).toContain("守望者零号");
    expect(markup).toContain("引航者一号");
    expect(markup).toContain("静谧观测室");
    expect(markup).toContain("晨光图书室");
  });

  it("locks partner, scene and import mutations during a session", () => {
    const markup = render(true);
    expect(markup.match(/<select aria-label="选择伙伴"[^>]*>/)?.[0]).toContain("disabled");
    expect(markup.match(/<select aria-label="选择场景"[^>]*>/)?.[0]).toContain("disabled");
    expect(markup.match(/<button class="button button--secondary"[^>]*>/)?.[0]).toContain("disabled");
  });
});
