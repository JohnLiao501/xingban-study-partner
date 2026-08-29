# 阶段 4：白厄私有伙伴包（星轨麦田背景）制作规格与实施手册

> **文档性质**：本文档为阶段 4（白厄私有伙伴包与多伙伴系统）的官方技术规范与交接执行手册。任何负责该阶段的 AI Agent 必须严格遵守本文档所规定的架构规范与版权隔离边界。

---

## 1. 核心定位与原则

1. **底层代码伙伴无关**：
   - 核心代码库（`electron/`, `shared/`, `src/`）严禁硬编码任何关于“白厄”、“星穹铁道”、“麦田”的专有逻辑、路径或分支。
   - 所有伙伴包（包括内置的 `demo-guardian` 和任何私有包）均统一遵循 `schemas/partner-pack.v1.schema.json`。
2. **私有包与版权隔离**：
   - 白厄属于《崩坏：星穹铁道》衍生设定，定性为 `sourceType: "private-fan"`，分发限制为 `distribution: "private-only"`。
   - 私有包存放于本地私有目录（`private-packs/` 或 `userData/partners/`），该目录必须加入 `.gitignore`，严禁随代码库提交或公开分发。
3. **音频与媒体原创规范**：
   - 语音严禁抓取游戏原声或克隆配音演员原声（`clonedRealPerson: false`），采用原创合成音色（TTS）或字幕模式（`subtitle-only`）。
   - 视频资源格式统一：H.264 编码、1080p、24fps、无水印、无烧录字幕。

---

## 2. 场景设定：【星轨麦田】（Starlight Wheatfield）

- **场景 ID**：`starlight-wheatfield`
- **场景显示名**：`星轨麦田`
- **视觉风格**：
  - 汲取《崩坏：星穹铁道》的世界观与地图美学，呈现广袤无垠的金色麦浪。
  - 天空为渐变的暮色星空，可见隐约的星环、极光、虚空轨道或远处星舰/列车掠过的柔和光痕。
  - 地面有木质栅栏、石质长椅或小型星轨指示灯柱，微风吹拂麦穗形成波浪起伏。
  - 整体氛围宁静、温暖、辽阔、专注，带来强大的陪伴感与安定感。
- **场景封面图规范**：
  - 文件路径：`assets/cover/starlight-wheatfield.webp`
  - 格式：WebP，1920×1080，小于 1MB。

---

## 3. 白厄角色人格与 10 类动作台词设定

- **伙伴 ID**：`baie-private`
- **伙伴显示名**：`白厄`
- **版本号**：`1.0.0`
- **人格摘要**：温和优雅、从容冷静、充满信赖感的星轨引航者。以适度的鼓励和坚定的守护协助用户保持心流，不批评、不施加额外焦虑。
- **信赖等级**：
  - 等级 1：`first-meeting`（初识，0 基础信赖）
  - 等级 2：`trusted-companion`（同行者，100 信赖）
  - 等级 3：`eternal-voyager`（星海守望，300 信赖）

### 10 类反应动作与台词映射表

| 动作 Key (`reactionKey`) | 镜头/动作表现 | 台词内容（lines） | 触发时机 |
| :--- | :--- | :--- | :--- |
| `idle_loop` | 站在麦田中，微风吹拂发丝与麦浪，偶尔温和注视镜头 | “麦穗在风中低语……准备好时，我们便启程。”<br>“静听风的声音，心会慢慢静下来。” | 常态待机（循环播放） |
| `session_start` | 微微躬身或轻点头，目光专注笃定 | “航向已定。在这片星轨麦浪前，专注于你手头的事吧。” | 会话正式开启 |
| `patrol_enter` | 视线抬起，柔和地看过来，仿佛关切地查探 | “星芒流转，我来看看你的专注进展如何。” | 随机巡查介入触发 |
| `focus_confirmed` (变体1) | 露出温和欣慰的浅笑，轻轻点头 | “心无旁骛，宛如沉甸的麦穗，状态很好。” | 判定专注通过 |
| `focus_confirmed` (变体2) | 抬手微扶胸口，给予赞许眼神 | “步调非常沉稳，继续保持这份节奏。” | 判定专注通过（随机轮换） |
| `uncertain_nudge` | 微微偏头，眼神带着询问与提醒 | “微风似乎有些紊乱……确认一下你的注意力还在轨道上吗？” | 无法明确判定时提醒（不扣偏航） |
| `distracted_warning` (变体1) | 表情转为严肃认真，目光直视 | “旅人，思绪已偏离了麦田，是时候回到正轨了。” | 确认分心（消耗 1 次偏航） |
| `distracted_warning` (变体2) | 轻轻合上笔记本或抬手示意暂停 | “前方的路还很长，不要被沿途的杂草绊住了脚步。” | 确认分心（再次提醒） |
| `recovery` | 神情重新舒展，微微一笑 | “很好，指针已重新校准，继续前行。” | 偏航后恢复专注 5 分钟 |
| `break_invite` | 侧身示意远方的麦田与落日，姿态放松 | “风吹过来了，起来活动一下，看看远方的麦浪吧。” | 专注时长达成，进入休息 |
| `session_complete` | 展颜微笑，由衷肯定与祝贺 | “耕耘终迎丰收。今天的全部成果，都是你星途上的勋章。” | 会话圆满完成结算 |
| `session_partial` | 给予包容与鼓励的眼神 | “行至此处亦是收获。养精蓄锐，我们随时可以再次启程。” | 提前终止或中断结算 |

---

## 4. 目录结构与打包规范

```text
private-packs/
  baie-wheatfield/
    manifest.json
    assets/
      cover/
        starlight-wheatfield.webp
      video/
        idle-loop.mp4
        session-start.mp4
        patrol-enter.mp4
        focus-confirmed-1.mp4
        focus-confirmed-2.mp4
        uncertain-nudge.mp4
        distracted-warning-1.mp4
        distracted-warning-2.mp4
        recovery.mp4
        break-invite.mp4
        session-complete.mp4
        session-partial.mp4
      audio/ (可选，若为 subtitle-only 则无需)
```

---

## 5. 多伙伴切换与协议架构

1. **协议支持**：
   - 注册 `partner-asset://` 协议，主进程截获后通过安全的 `net.fetch(pathToFileURL(fullPath))` 读取，避开沙箱与 CSP 限制。
2. **状态更新**：
   - `window.studyPartner.listInstalledPartners()` 获取全部可用伙伴。
   - `window.studyPartner.selectPartner(partnerId)` 切换激活伙伴，并自动存储至 `app_settings` 表（key: `active_partner_id`）。
   - 前端 `App.tsx` 监听伙伴切换，重置 scene、reaction 并加载新的 `manifest`。
3. **数据库存储**：
   - 已安装伙伴存放在 `partner_packs` 表中，每个伙伴独立累计 `partner_progress` 表中的 `total_trust`。

---

## 6. 验收与交付要求

下一位 Agent 完成实现后，必须通过以下全部门禁：
1. `pnpm run typecheck` 0 错误；
2. `pnpm test` 全量通过；
3. `pnpm run build` 打包构建成功；
4. Git 提交并推送至 `origin/master`。
