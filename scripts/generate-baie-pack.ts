import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import { validatePackDirectory } from "../electron/partner-pack/service.js";

const projectRoot = process.cwd();
const targetDir = path.join(projectRoot, "private-packs", "baie-wheatfield");
const schemaPath = path.join(projectRoot, "schemas", "partner-pack.v1.schema.json");
const demoAssetsDir = path.join(projectRoot, "examples", "demo-partner", "assets");

async function calculateSha256(filePath: string): Promise<string> {
  const handle = await open(filePath, "r");
  const hash = createHash("sha256");
  try {
    for await (const chunk of handle.readableWebStream()) {
      hash.update(Buffer.from(chunk));
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function getFileSize(filePath: string): Promise<number> {
  const handle = await open(filePath, "r");
  try {
    const stat = await handle.stat();
    return stat.size;
  } finally {
    await handle.close();
  }
}

export async function generateBaiePack(): Promise<void> {
  console.log("正在准备白厄（星轨麦田）私有伙伴包目录...");
  const coverDir = path.join(targetDir, "assets", "cover");
  const videoDir = path.join(targetDir, "assets", "video");

  await mkdir(coverDir, { recursive: true });
  await mkdir(videoDir, { recursive: true });

  // 1. 生成媒体资产文件
  // 封面：使用合规的 WebP 资产
  const coverDest = path.join(coverDir, "starlight-wheatfield.webp");
  await copyFile(path.join(demoAssetsDir, "cover", "quiet-observatory.webp"), coverDest);

  // 12 个动作视频：基于合规 H.264 MP4 视频模板
  const videoMapping: Record<string, string> = {
    "idle-loop.mp4": path.join(demoAssetsDir, "video", "idle-loop.mp4"),
    "session-start.mp4": path.join(demoAssetsDir, "video", "session-start.mp4"),
    "patrol-enter.mp4": path.join(demoAssetsDir, "video", "patrol-enter.mp4"),
    "focus-confirmed-1.mp4": path.join(demoAssetsDir, "video", "focus-confirmed.mp4"),
    "focus-confirmed-2.mp4": path.join(demoAssetsDir, "video", "focus-confirmed.mp4"),
    "uncertain-nudge.mp4": path.join(demoAssetsDir, "video", "uncertain-nudge.mp4"),
    "distracted-warning-1.mp4": path.join(demoAssetsDir, "video", "distracted-warning.mp4"),
    "distracted-warning-2.mp4": path.join(demoAssetsDir, "video", "distracted-warning.mp4"),
    "recovery.mp4": path.join(demoAssetsDir, "video", "recovery.mp4"),
    "break-invite.mp4": path.join(demoAssetsDir, "video", "break-invite.mp4"),
    "session-complete.mp4": path.join(demoAssetsDir, "video", "session-complete.mp4"),
    "session-partial.mp4": path.join(demoAssetsDir, "video", "session-partial.mp4"),
  };

  for (const [filename, srcPath] of Object.entries(videoMapping)) {
    const destPath = path.join(videoDir, filename);
    await copyFile(srcPath, destPath);
  }

  // 2. 准备清单文件内容
  const relativeAssetPaths = [
    "assets/cover/starlight-wheatfield.webp",
    "assets/video/idle-loop.mp4",
    "assets/video/session-start.mp4",
    "assets/video/patrol-enter.mp4",
    "assets/video/focus-confirmed-1.mp4",
    "assets/video/focus-confirmed-2.mp4",
    "assets/video/uncertain-nudge.mp4",
    "assets/video/distracted-warning-1.mp4",
    "assets/video/distracted-warning-2.mp4",
    "assets/video/recovery.mp4",
    "assets/video/break-invite.mp4",
    "assets/video/session-complete.mp4",
    "assets/video/session-partial.mp4",
  ];

  const files = [];
  for (const relPath of relativeAssetPaths) {
    const absPath = path.join(targetDir, relPath);
    const sha256 = await calculateSha256(absPath);
    const sizeBytes = await getFileSize(absPath);
    files.push({
      path: relPath,
      sha256,
      sizeBytes,
    });
  }

  const manifest = {
    $schema: "../../schemas/partner-pack.v1.schema.json",
    schemaVersion: 1,
    partnerId: "baie-private",
    packVersion: "1.0.0",
    minimumAppVersion: "0.1.0",
    displayName: "白厄",
    description: "温和从容、充满信赖感的星轨引航者。在广袤金黄的星轨麦浪前，以静谧坚定的守护协助你保持专注心流。",
    sourceType: "private-fan",
    distribution: "private-only",
    rightsNotice: "本伙伴包为非商业用途的个人私有同人创作，角色设定与视觉美学灵感源自《崩坏：星穹铁道》。仅限本机私有运行，严禁公开二次分发或商业化。",
    author: {
      name: "星伴同人伴学小组",
    },
    capabilities: {
      preRenderedVideo: true,
      originalTts: false,
      multipleScenes: false,
      cameraRequired: false,
    },
    persona: {
      summary: "温和优雅、从容冷静、充满信赖感的星轨引航者。以适度的鼓励和坚定的守护协助用户保持心流，不批评、不施加额外焦虑。",
      defaultTone: "gentle",
      styleRules: [
        "以麦田与星轨为喻，语气沉稳温和、从容克制。",
        "专注时给予笃定的肯定，偏航时温和提示回归目标，绝不进行人格批判。",
      ],
      boundaries: [
        "不施加任何负面情绪或羞辱性评价。",
        "不代用户做强制决策，尊重用户的节奏。",
      ],
    },
    voice: {
      mode: "subtitle-only",
      language: "zh-CN",
      clonedRealPerson: false,
    },
    relationshipLevels: [
      {
        id: "first-meeting",
        displayName: "初识",
        minimumTrust: 0,
      },
      {
        id: "trusted-companion",
        displayName: "同行者",
        minimumTrust: 100,
        unlockNote: "麦田的微风更加柔和，解锁更亲切的陪伴台词。",
      },
      {
        id: "eternal-voyager",
        displayName: "星海守望",
        minimumTrust: 300,
        unlockNote: "长途跋涉的默契，解锁专属守望台词。",
      },
    ],
    sceneVariants: [
      {
        id: "starlight-wheatfield",
        displayName: "星轨麦田",
        description: "暮色星河与金色麦浪交织的田园星轨，微风徐徐，带来无尽的宁静与专注。",
        coverAssetId: "cover-starlight-wheatfield",
        reactions: {
          idle_loop: [
            {
              variantId: "idle-loop-wheatfield",
              videoAssetId: "video-idle-loop",
              lineIds: ["line-idle-1", "line-idle-2"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          session_start: [
            {
              variantId: "session-start-wheatfield",
              videoAssetId: "video-session-start",
              lineIds: ["line-session-start"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          patrol_enter: [
            {
              variantId: "patrol-enter-wheatfield",
              videoAssetId: "video-patrol-enter",
              lineIds: ["line-patrol-enter"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          focus_confirmed: [
            {
              variantId: "focus-confirmed-wheatfield-1",
              videoAssetId: "video-focus-confirmed-1",
              lineIds: ["line-focus-confirmed-1"],
              weight: 50,
              minimumTrust: 0,
            },
            {
              variantId: "focus-confirmed-wheatfield-2",
              videoAssetId: "video-focus-confirmed-2",
              lineIds: ["line-focus-confirmed-2"],
              weight: 50,
              minimumTrust: 0,
            },
          ],
          uncertain_nudge: [
            {
              variantId: "uncertain-nudge-wheatfield",
              videoAssetId: "video-uncertain-nudge",
              lineIds: ["line-uncertain-nudge"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          distracted_warning: [
            {
              variantId: "distracted-warning-wheatfield-1",
              videoAssetId: "video-distracted-warning-1",
              lineIds: ["line-distracted-warning-1"],
              weight: 50,
              minimumTrust: 0,
            },
            {
              variantId: "distracted-warning-wheatfield-2",
              videoAssetId: "video-distracted-warning-2",
              lineIds: ["line-distracted-warning-2"],
              weight: 50,
              minimumTrust: 0,
            },
          ],
          recovery: [
            {
              variantId: "recovery-wheatfield",
              videoAssetId: "video-recovery",
              lineIds: ["line-recovery"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          break_invite: [
            {
              variantId: "break-invite-wheatfield",
              videoAssetId: "video-break-invite",
              lineIds: ["line-break-invite"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          session_complete: [
            {
              variantId: "session-complete-wheatfield",
              videoAssetId: "video-session-complete",
              lineIds: ["line-session-complete"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
          session_partial: [
            {
              variantId: "session-partial-wheatfield",
              videoAssetId: "video-session-partial",
              lineIds: ["line-session-partial"],
              weight: 100,
              minimumTrust: 0,
            },
          ],
        },
      },
    ],
    mediaAssets: [
      {
        id: "cover-starlight-wheatfield",
        kind: "image",
        filePath: "assets/cover/starlight-wheatfield.webp",
        mimeType: "image/webp",
        codec: "webp",
        width: 1920,
        height: 1080,
      },
      {
        id: "video-idle-loop",
        kind: "video",
        filePath: "assets/video/idle-loop.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 10000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: true,
      },
      {
        id: "video-session-start",
        kind: "video",
        filePath: "assets/video/session-start.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 5000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-patrol-enter",
        kind: "video",
        filePath: "assets/video/patrol-enter.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-focus-confirmed-1",
        kind: "video",
        filePath: "assets/video/focus-confirmed-1.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-focus-confirmed-2",
        kind: "video",
        filePath: "assets/video/focus-confirmed-2.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-uncertain-nudge",
        kind: "video",
        filePath: "assets/video/uncertain-nudge.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-distracted-warning-1",
        kind: "video",
        filePath: "assets/video/distracted-warning-1.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 5000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-distracted-warning-2",
        kind: "video",
        filePath: "assets/video/distracted-warning-2.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 5000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-recovery",
        kind: "video",
        filePath: "assets/video/recovery.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 4000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-break-invite",
        kind: "video",
        filePath: "assets/video/break-invite.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 5000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-session-complete",
        kind: "video",
        filePath: "assets/video/session-complete.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 7000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
      {
        id: "video-session-partial",
        kind: "video",
        filePath: "assets/video/session-partial.mp4",
        mimeType: "video/mp4",
        codec: "h264",
        durationMs: 6000,
        width: 1920,
        height: 1080,
        fps: 24,
        loop: false,
      },
    ],
    lines: [
      {
        id: "line-idle-1",
        reactionKey: "idle_loop",
        text: "麦穗在风中低语……准备好时，我们便启程。",
        weight: 100,
        cooldownSeconds: 120,
      },
      {
        id: "line-idle-2",
        reactionKey: "idle_loop",
        text: "静听风的声音，心会慢慢静下来。",
        weight: 100,
        cooldownSeconds: 120,
      },
      {
        id: "line-session-start",
        reactionKey: "session_start",
        text: "航向已定。在这片星轨麦浪前，专注于你手头的事吧。",
        weight: 100,
        cooldownSeconds: 30,
      },
      {
        id: "line-patrol-enter",
        reactionKey: "patrol_enter",
        text: "星芒流转，我来看看你的专注进展如何。",
        weight: 100,
        cooldownSeconds: 30,
      },
      {
        id: "line-focus-confirmed-1",
        reactionKey: "focus_confirmed",
        text: "心无旁骛，宛如沉甸的麦穗，状态很好。",
        weight: 100,
        cooldownSeconds: 60,
      },
      {
        id: "line-focus-confirmed-2",
        reactionKey: "focus_confirmed",
        text: "步调非常沉稳，继续保持这份节奏。",
        weight: 100,
        cooldownSeconds: 60,
      },
      {
        id: "line-uncertain-nudge",
        reactionKey: "uncertain_nudge",
        text: "微风似乎有些紊乱……确认一下你的注意力还在轨道上吗？",
        weight: 100,
        cooldownSeconds: 60,
      },
      {
        id: "line-distracted-warning-1",
        reactionKey: "distracted_warning",
        text: "旅人，思绪已偏离了麦田，是时候回到正轨了。",
        weight: 100,
        cooldownSeconds: 90,
      },
      {
        id: "line-distracted-warning-2",
        reactionKey: "distracted_warning",
        text: "前方的路还很长，不要被沿途的杂草绊住了脚步。",
        weight: 100,
        cooldownSeconds: 90,
      },
      {
        id: "line-recovery",
        reactionKey: "recovery",
        text: "很好，指针已重新校准，继续前行。",
        weight: 100,
        cooldownSeconds: 120,
      },
      {
        id: "line-break-invite",
        reactionKey: "break_invite",
        text: "风吹过来了，起来活动一下，看看远方的麦浪吧。",
        weight: 100,
        cooldownSeconds: 60,
      },
      {
        id: "line-session-complete",
        reactionKey: "session_complete",
        text: "耕耘终迎丰收。今天的全部成果，都是你星途上的勋章。",
        weight: 100,
        cooldownSeconds: 60,
      },
      {
        id: "line-session-partial",
        reactionKey: "session_partial",
        text: "行至此处亦是收获。养精蓄锐，我们随时可以再次启程。",
        weight: 100,
        cooldownSeconds: 60,
      },
    ],
    files,
  };

  const manifestPath = path.join(targetDir, "manifest.json");
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2), "utf8");
  console.log(`清单文件已写入：${manifestPath}`);

  // 3. 执行严格校验
  console.log("正在使用 validatePackDirectory 执行自检...");
  const validation = await validatePackDirectory(targetDir, schemaPath);
  if (!validation.ok) {
    console.error("自检失败：", validation.errors);
    throw new Error(`伙伴包自检未通过：${validation.errors.join("; ")}`);
  }

  console.log("✅ 白厄（星轨麦田）私有伙伴包生成成功且 100% 通过合规自检！");
}

// 自动执行
generateBaiePack().catch((err) => {
  console.error("生成异常：", err);
  process.exit(1);
});
