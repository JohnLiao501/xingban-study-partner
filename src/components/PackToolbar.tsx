import type { InstalledPartnerSummary, PartnerPackManifestV1 } from "../../shared/partner-pack";
import { Icon } from "./Icon";

interface PackToolbarProps {
  manifest: PartnerPackManifestV1;
  installedPartners?: InstalledPartnerSummary[];
  sceneId: string;
  desktopRuntime: boolean;
  sessionActive: boolean;
  importing?: boolean;
  onPartnerChange?: (partnerId: string) => void;
  onSceneChange: (sceneId: string) => void;
  onImport: () => void;
  onStart: () => void;
}

export function PackToolbar({
  manifest,
  installedPartners,
  sceneId,
  desktopRuntime,
  sessionActive,
  importing = false,
  onPartnerChange,
  onSceneChange,
  onImport,
  onStart,
}: PackToolbarProps) {
  return (
    <section className="pack-toolbar" aria-label="伙伴与场景">
      <label className="select-field">
        <span>伙伴</span>
        <select
          aria-label="选择伙伴"
          disabled={sessionActive || importing || !onPartnerChange || (installedPartners !== undefined && installedPartners.length <= 1)}
          onChange={(event) => onPartnerChange?.(event.target.value)}
          value={manifest.partnerId}
        >
          {installedPartners && installedPartners.length > 0 ? (
            installedPartners.map((partner) => (
              <option key={partner.partnerId} value={partner.partnerId}>
                {partner.displayName}
              </option>
            ))
          ) : (
            <option value={manifest.partnerId}>{manifest.displayName}</option>
          )}
        </select>
      </label>

      <span className="toolbar-divider" aria-hidden="true" />
      <label className="select-field">
        <span>场景</span>
        <select
          aria-label="选择场景"
          disabled={sessionActive || importing}
          onChange={(event) => onSceneChange(event.target.value)}
          value={sceneId}
        >
          {manifest.sceneVariants.map((scene) => (
            <option key={scene.id} value={scene.id}>{scene.displayName}</option>
          ))}
        </select>
      </label>
      <div className="pack-toolbar__actions">
        <button className="button button--primary" disabled={sessionActive || importing} onClick={onStart} type="button">
          <Icon name="play" size={17} />
          {sessionActive ? "学习进行中" : "开始学习"}
        </button>
        <button
          className="button button--secondary"
          disabled={sessionActive || importing}
          onClick={onImport}
          title={sessionActive ? "请先结束当前学习会话" : desktopRuntime ? "选择 ZIP 文件或伙伴包目录" : "请在 Electron 桌面版使用"}
          type="button"
        >
          <Icon name="import" size={18} />
          {importing ? "正在导入…" : "导入伙伴包"}
        </button>
      </div>
    </section>
  );
}
