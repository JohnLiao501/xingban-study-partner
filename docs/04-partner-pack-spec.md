# 督学伙伴包协议

## 1. 设计原则

伙伴包是纯声明式内容，不是可执行插件。基础应用不得依赖某个角色的姓名、设定或动作数量；白厄与后续角色均使用同一个 `PartnerPackManifestV1`。

## 2. 包目录

```text
<partner-pack>/
  manifest.json
  assets/
    cover/*.webp
    video/*.mp4
    audio/*.ogg
```

不允许脚本、可执行文件、HTML、符号链接或指向包外的路径。字幕直接存于 `lines[].text`；原创 TTS 通过 `audioAssetId` 关联音频。

## 3. 顶层字段

| 字段 | 含义 |
| --- | --- |
| `schemaVersion` | 固定为 1。 |
| `partnerId` | 全局稳定的 kebab-case 标识。 |
| `packVersion` | 伙伴包语义化版本。 |
| `minimumAppVersion` | 能读取此包的最低应用版本。 |
| `sourceType` | `private-fan` 或 `original`。 |
| `distribution` | `private-only` 或 `redistributable`。 |
| `persona` | 人格摘要、语气、表达规则和边界。 |
| `voice` | 字幕/TTS 模式、语言及真人克隆声明。 |
| `relationshipLevels` | 按信赖阈值升序排列的等级。 |
| `sceneVariants` | 一个或多个完整预渲染场景。 |
| `mediaAssets` | 可引用的图片、视频和音频元数据。 |
| `lines` | 字幕、音频引用、权重及冷却时间。 |
| `files` | 包内所有资源的大小和 SHA-256。 |

`private-fan` 必须配合 `private-only`。`clonedRealPerson` 在 v1 中必须为 `false`。

## 4. 固定动作键

每个 `sceneVariant` 的 `reactions` 必须完整声明以下十个键，每个键至少一个候选：

1. `idle_loop`
2. `session_start`
3. `patrol_enter`
4. `focus_confirmed`
5. `uncertain_nudge`
6. `distracted_warning`
7. `recovery`
8. `break_invite`
9. `session_complete`
10. `session_partial`

候选引用一个视频、一个或多个台词，并可设置 `weight` 与 `minimumTrust`。应用按权重选择满足信赖阈值且未在冷却期的候选。

## 5. 媒体规格

### 5.1 视频

- MP4 容器、H.264、`yuv420p`、1920×1080、24 fps。
- 普通反应建议 3～8 秒；`idle_loop` 建议 8～15 秒并无明显跳帧。
- 视频不内嵌对白，以便字幕和原创 TTS 独立替换。
- 不接受水印、可读生成提示、字幕烧录或无法授权的真人肖像。

### 5.2 音频

- OGG/Opus，48 kHz，单声道或双声道。
- TTS 必须是原创合成音色，不克隆原配音演员或其他真人。
- 语音与字幕语义一致；媒体 QA 要求起始误差不超过 200 ms。

### 5.3 图片

- WebP，推荐 16:9，作为场景封面与选择页预览。

## 6. 场景与角色绑定

预渲染视频已包含人物和环境，因此场景不是可随意替换的背景图。每个 `sceneVariant` 必须为同一伙伴提供一整套十类反应。新增场景应增加新的 `sceneVariant`，而不是把其他角色的场景资源拼接进来。

## 7. 关系等级

- 至少一个等级，首级 `minimumTrust` 必须为 0。
- 阈值严格递增，ID 在同一伙伴包内唯一。
- 升级包不得移除低于用户当前信赖可访问的全部内容。
- 信赖保存在应用数据库，以 `partnerId` 为主键，不写回伙伴包。

## 8. 白厄首包制作规格

白厄包属于 `private-fan + private-only`，只安装在本机：

- 输入资料：正面全身、面部特写、三分之二角度、服装细节、表情与场景参考。
- 先生成角色视觉圣经与标准关键帧，再使用 Runway 按动作键生成视频。
- 共 12 条：`focus_confirmed` 和 `distracted_warning` 各 2 条，其余各 1 条。
- 每条视频进行身份、脸型、服装、手部、场景、镜头连续性与水印 QA。
- 字幕和原创 TTS 独立生成；不使用原游戏音频或配音克隆。

## 9. 校验层级

1. JSON 可解析且通过 `partner-pack.v1.schema.json`。
2. `partnerId + packVersion` 不与已安装包冲突。
3. 所有引用 ID 存在，且媒体类型符合引用位置。
4. 十类动作完整，最低信赖时每类至少有一个可用候选。
5. `files` 与实际文件一一对应，大小和 SHA-256 正确。
6. 媒体探测结果符合编码、尺寸、帧率和时长要求。
7. 路径均为包内相对路径且没有禁止扩展名。

仓库内原创 demo 包同时提供清单与轻量媒体，用于播放器开发和安装期校验；它不代表正式伙伴的素材质量。第三方角色包仍不得进入仓库。
