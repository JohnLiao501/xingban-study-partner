import { useEffect, useMemo, useState } from "react";
import {
  REACTION_LABELS,
  type BootstrapData,
  type InstalledPartnerSummary,
  type ReactionKey,
} from "../shared/partner-pack";
import { ActionPanel } from "./components/ActionPanel";
import { HistoryView } from "./components/HistoryView";
import { MediaStage } from "./components/MediaStage";
import { PackToolbar } from "./components/PackToolbar";
import { RulesView } from "./components/RulesView";
import { SessionPanel } from "./components/SessionPanel";
import { SessionSetupDialog } from "./components/SessionSetupDialog";
import { Sidebar, type AppView } from "./components/Sidebar";
import { TitleBar } from "./components/TitleBar";
import { useSessionController } from "./hooks/useSessionController";
import { useAppRules } from "./hooks/useAppRules";
import { findReactionPreview, loadBootstrapData } from "./lib/partner";

const SESSION_ACTIVITY_LABELS = {
  preparing: "准备中",
  focusing: "专注陪伴中",
  patrolling: "正在巡查",
  feedback: "反馈中",
  break: "休息陪伴中",
  completed: "本场已完成",
  aborted: "本场已放弃",
  interrupted: "本场已中断",
} as const;

export default function App() {
  const [bootstrap, setBootstrap] = useState<BootstrapData>();
  const [installedPartners, setInstalledPartners] = useState<InstalledPartnerSummary[]>([]);
  const [loadError, setLoadError] = useState<string>();
  const [sceneId, setSceneId] = useState("");
  const [reactionKey, setReactionKey] = useState<ReactionKey>("idle_loop");
  const [notice, setNotice] = useState("demo 伙伴包已通过完整校验");
  const [setupOpen, setSetupOpen] = useState(false);
  const [currentView, setCurrentView] = useState<AppView>("study");
  const session = useSessionController();
  const appRules = useAppRules();

  const refreshInstalledPartners = async () => {
    if (window.studyPartner) {
      try {
        const list = await window.studyPartner.listInstalledPartners();
        setInstalledPartners(list);
      } catch {}
    }
  };

  useEffect(() => {
    let active = true;
    loadBootstrapData()
      .then((data) => {
        if (!active) return;
        setBootstrap(data);
        setSceneId(data.manifest.sceneVariants[0]?.id ?? "");
      })
      .catch((error: unknown) => {
        if (active) setLoadError(error instanceof Error ? error.message : "伙伴包加载失败");
      });
    void refreshInstalledPartners();
    return () => {
      active = false;
    };
  }, []);

  const handlePartnerChange = async (partnerId: string) => {
    if (!window.studyPartner) return;
    try {
      const data = await window.studyPartner.selectPartner(partnerId);
      setBootstrap(data);
      const initialScene = data.manifest.sceneVariants[0]?.id ?? "";
      setSceneId(initialScene);
      setReactionKey("idle_loop");
      void session.refreshProgress(partnerId);
      setNotice(`已切换为督学伙伴：${data.manifest.displayName}`);
      void refreshInstalledPartners();
    } catch (error) {
      setNotice(`切换伙伴失败：${error instanceof Error ? error.message : "未知错误"}`);
    }
  };


  const preview = useMemo(() => {
    if (!bootstrap || !sceneId) return undefined;
    const effectiveReaction = session.snapshot?.reactionKey ?? reactionKey;
    return findReactionPreview(bootstrap.manifest, sceneId, effectiveReaction);
  }, [bootstrap, reactionKey, sceneId, session.snapshot?.reactionKey]);

  useEffect(() => {
    if (!window.studyPartner || !preview || !session.snapshot) return undefined;
    const shouldShow = session.snapshot.phase === "patrolling" || session.snapshot.phase === "feedback";
    if (!shouldShow) {
      void window.studyPartner.hideOverlay();
      return undefined;
    }
    void window.studyPartner.showOverlayPreview({
      reactionKey: preview.reactionKey,
      label: REACTION_LABELS[preview.reactionKey],
      line: preview.line.text,
      videoPath: preview.video.filePath,
      loop: Boolean(preview.video.loop),
    });
    return undefined;
  }, [preview, session.snapshot?.phase]);

  useEffect(() => {
    const partnerId = bootstrap?.manifest.partnerId;
    if (partnerId) void session.refreshProgress(partnerId);
  }, [bootstrap?.manifest.partnerId]);

  if (loadError) {
    return (
      <main className="boot-state boot-state--error">
        <h1>无法进入督学室</h1>
        <p>{loadError}</p>
      </main>
    );
  }
  if (!bootstrap || !preview) {
    return (
      <main className="boot-state">
        <span className="boot-spinner" aria-hidden="true" />
        <p>正在校验伙伴包…</p>
      </main>
    );
  }

  const { manifest, desktopRuntime } = bootstrap;
  const scene = manifest.sceneVariants.find((candidate) => candidate.id === sceneId)
    ?? manifest.sceneVariants[0];
  const cover = manifest.mediaAssets.find((asset) => asset.id === scene.coverAssetId);
  if (!cover) throw new Error("PACK_REFERENCE_INVALID coverAssetId");
  const progress = session.progressByPartner[manifest.partnerId] ?? {
    partnerId: manifest.partnerId,
    totalTrust: 0,
    currentLevelId: manifest.relationshipLevels[0]?.id ?? "initial",
    lastSessionAt: null,
  };
  const currentLevel = manifest.relationshipLevels
    .filter((level) => level.minimumTrust <= progress.totalTrust)
    .sort((left, right) => right.minimumTrust - left.minimumTrust)[0]
    ?? manifest.relationshipLevels[0];

  const selectReaction = (nextReaction: ReactionKey) => {
    setReactionKey(nextReaction);
    setNotice(`已切换到“${REACTION_LABELS[nextReaction]}”`);
  };

  const sessionNotice = session.error
    ? `会话操作失败：${session.error}`
    : session.snapshot && session.active
      ? `${SESSION_ACTIVITY_LABELS[session.snapshot.phase]} · 偏航 ${session.snapshot.deviationCount}/3`
      : session.snapshot?.outcome
        ? `本场已结算：评价 ${session.snapshot.outcome.grade ?? "—"}，信赖 +${session.snapshot.outcome.trustGained}`
        : notice;

  const importPartner = async () => {
    if (!window.studyPartner) {
      setNotice("伙伴包目录导入仅在 Electron 桌面版可用");
      return;
    }
    const result = await window.studyPartner.importPartnerDirectory();
    if (result.cancelled) {
      setNotice("已取消导入");
    } else if (result.ok && result.manifest) {
      setNotice(`已安装 ${result.manifest.displayName} ${result.manifest.packVersion}`);
      await refreshInstalledPartners();
      await handlePartnerChange(result.manifest.partnerId);
    } else {
      setNotice(result.errors[0] ?? "伙伴包导入失败");
    }
  };

  const showOverlay = async () => {
    if (!window.studyPartner) {
      setNotice("巡查悬浮窗仅在 Electron 桌面版可用");
      return;
    }
    await window.studyPartner.showOverlayPreview({
      reactionKey,
      label: REACTION_LABELS[reactionKey],
      line: preview.line.text,
      videoPath: preview.video.filePath,
      loop: Boolean(preview.video.loop),
    });
    setNotice("已在巡查悬浮窗中预览当前动作");
  };

  return (
    <div className="app-shell">
      <TitleBar />
      <div className="app-body">
        <Sidebar
          currentView={currentView}
          onNavigate={(view) => {
            setCurrentView(view);
            if (view === "history") {
              void session.refreshHistory();
              void session.refreshProgress(manifest.partnerId);
            } else if (view === "settings") {
              void appRules.refresh();
            }
          }}
        />
        {currentView === "settings" ? (
          <RulesView
            error={appRules.error}
            onBack={() => setCurrentView("study")}
            onDelete={(id) => void appRules.remove(id)}
            onSave={(input) => void appRules.save(input)}
            onToggle={(rule) => void appRules.save({
              id: rule.id,
              matchType: rule.matchType,
              pattern: rule.pattern,
              decision: rule.decision,
              enabled: !rule.enabled,
            })}
            rules={appRules.rules}
          />
        ) : currentView === "history" ? (
          <HistoryView
            history={session.history}
            levelName={currentLevel?.displayName ?? "初识"}
            onBack={() => setCurrentView("study")}
            onRefresh={() => {
              void session.refreshHistory();
              void session.refreshProgress(manifest.partnerId);
            }}
            partnerName={manifest.displayName}
            progress={progress}
          />
        ) : (
          <main className="study-room">
          <PackToolbar
            desktopRuntime={desktopRuntime}
            installedPartners={installedPartners}
            manifest={manifest}
            onImport={() => void importPartner()}
            onPartnerChange={(id) => void handlePartnerChange(id)}
            onSceneChange={setSceneId}
            onStart={() => setSetupOpen(true)}
            sceneId={sceneId}
            sessionActive={session.active}
          />
          <div className="stage-layout">
            <MediaStage
              activityLabel={session.snapshot ? SESSION_ACTIVITY_LABELS[session.snapshot.phase] : undefined}
              assetBaseUrl={bootstrap.assetBaseUrl}
              coverPath={cover.filePath}
              onShowOverlay={() => void showOverlay()}
              partnerName={manifest.displayName}
              preview={preview}
            />

            {session.snapshot ? (
              <SessionPanel
                acceptancePlan={bootstrap.acceptancePlan}
                manualInspectionControls={!desktopRuntime}
                onCompleteFeedback={() => void session.completeFeedback()}
                onFinish={(mode) => void session.finish(mode)}
                onNewSession={() => setSetupOpen(true)}
                onObserve={(label) => void session.observe(label)}
                onPause={() => void session.pause()}
                onPreviewPatrol={() => void session.previewPatrol()}
                onResume={() => void session.resume()}
                onStartBreak={() => void session.startBreak()}
                snapshot={session.snapshot}
              />
            ) : (
              <ActionPanel onSelect={selectReaction} selected={reactionKey} />
            )}
          </div>
          <footer className="status-bar" aria-live="polite">
            <span className="status-dot" />
            <span>{sessionNotice}</span>
            <span className="status-bar__spacer" />
            <span>{desktopRuntime ? "内容保护已启用" : "浏览器视觉预览"}</span>
          </footer>
          </main>
        )}
      </div>
      {setupOpen ? (
        <SessionSetupDialog
          acceptancePlan={bootstrap.acceptancePlan}
          onCancel={() => setSetupOpen(false)}
          onStart={(input) => {
            setSetupOpen(false);
            setNotice("会话已开始，随机巡查计划已经生成");
            void session.start(input);
          }}
          packVersion={manifest.packVersion}
          partnerId={manifest.partnerId}
          partnerName={manifest.displayName}
          sceneId={scene.id}
          sceneName={scene.displayName}
        />
      ) : null}
    </div>
  );
}
