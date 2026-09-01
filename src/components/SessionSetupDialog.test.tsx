import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createStage3AcceptancePlanView } from "../../shared/stage3-acceptance";
import { SessionSetupDialog } from "./SessionSetupDialog";

afterEach(() => {
  vi.unstubAllGlobals();
});

function render(acceptance = true): string {
  vi.stubGlobal("window", { studyPartner: undefined });
  return renderToStaticMarkup(
    <SessionSetupDialog
      acceptancePlan={acceptance ? createStage3AcceptancePlanView("notepad", "mspaint") : undefined}
      onCancel={() => {}}
      onStart={() => {}}
      packVersion="1.0.0"
      partnerId="demo.guardian-zero"
      partnerName="守望者零号"
      sceneId="quiet-observatory"
      sceneName="静谧观测站"
    />,
  );
}

describe("SessionSetupDialog stage 3 acceptance guard", () => {
  it("keeps the acceptance start disabled until source, mock settings and fixed rules are ready", () => {
    const markup = render(true);
    expect(markup).toContain("阶段 3 隔离验收模式");
    expect(markup).toContain('class="session-dialog__body"');
    expect(markup.indexOf('class="session-dialog__body"')).toBeLessThan(
      markup.indexOf('class="session-dialog__actions"'),
    );
    expect(markup).toContain("等待验收配置就绪");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>等待验收配置就绪<\/button>/);
  });

  it("does not block the ordinary local-only start path", () => {
    const markup = render(false);
    expect(markup).toContain(">开始本场</button>");
    expect(markup).not.toContain("等待验收配置就绪");
  });

  it("keeps the long form scrollable while the action bar stays in the viewport", () => {
    const styles = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    const dialogRule = styles.match(/\.session-dialog\s*\{([^}]+)\}/)?.[1] ?? "";
    const bodyRule = styles.match(/\.session-dialog__body\s*\{([^}]+)\}/)?.[1] ?? "";
    const actionsRule = styles.match(/\.session-dialog__actions\s*\{([^}]+)\}/)?.[1] ?? "";

    expect(dialogRule).toContain("max-height: calc(100dvh - 48px)");
    expect(dialogRule).toContain("overflow: hidden");
    expect(bodyRule).toContain("overflow-y: auto");
    expect(bodyRule).toContain("min-height: 0");
    expect(actionsRule).toContain("flex: none");
  });
});
