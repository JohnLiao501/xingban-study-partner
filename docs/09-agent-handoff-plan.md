# 下一位 AI Agent 交接与后续执行计划

> 基线日期：2026-08-29  
> 适用范围：本仓库下一阶段开发与验收  
> 当前主线：阶段 3「屏幕巡查与兼容 AI」  
> 开工前置：完整阅读根目录 `AGENTS.md`、`README.md` 和本文

本文是给下一位 AI Agent 的可执行交接单。它不依赖此前聊天记录；若本文的基线与现场文件冲突，必须先以只读检查确认现状，再更新计划，不能直接覆盖用户已有工作。

## 1. 最终目标与本轮边界

阶段 3 的目标是把现有“会话与本地数据底座”扩展为可实际使用、可停止、可降级且隐私可验证的屏幕巡查闭环：

```text
主进程随机发起巡查
  -> Windows 前台探针给出应用/标题
  -> 本地允许/禁止规则优先判断
  -> 规则未知且用户已授权时，只取一张低分辨率单帧
  -> 可选兼容多模态 API 返回结构化判断
  -> 阈值与二次确认策略
  -> SessionEngine 更新反馈、偏航次数和信赖结算
  -> SQLite 只保存结构化结果
```

阶段 3 完成前不要开展以下工作：

- 白厄或其他第三方 IP 伙伴包、图像、视频、字幕、台词或配音制作；
- Obsidian、摄像头、麦克风、自由语音、实时 3D、云同步、账号或伙伴市场；
- ZIP 伙伴包安装、自动更新、公开发布或商业化；
- 为未来功能提前重构整个 UI 或替换现有技术栈。

## 2. 已验证的项目基线

### 2.1 已完成范围

| 阶段 | 已完成内容 | 当前状态 |
| --- | --- | --- |
| 阶段 0 | 中文规格、伙伴包协议、JSON Schema、原创示例包 | 已完成 |
| 阶段 1 | Electron 多窗口、托盘、受限 preload、示例伙伴播放器和文件夹导入校验 | 已完成 |
| 阶段 2A | 会话纯状态机、计时、暂停/恢复、随机巡查、三类判断、三次偏航、休息、等级和信赖 | 已完成 |
| 阶段 2B | SQLite、活动会话检查点、安全恢复、历史、关系进度、允许/禁止规则管理 | 已完成 |
| 阶段 3 | Windows 前台探针、自动规则判断、真实单帧捕获、兼容 AI | 尚未完成 |

现有实现能够运行 10～180 分钟会话，Electron 主进程掌握权威时间，浏览器预览与主进程共用纯状态机。已有主督学室、置顶巡查窗、隐藏截图工作窗和托盘，但“隐藏截图工作窗存在”不等于“真实安全捕获已经实现”。

### 2.2 技术栈与命令

- Electron 44.0.0
- React / React DOM 19.2.8
- TypeScript 7.0.2
- Vite 8.2.2
- Vitest 4.1.11
- AJV 8.20.0
- Node.js >= 24.18.1
- pnpm 11.19.0

当前有效命令：

```powershell
pnpm run typecheck
pnpm test
pnpm run build
pnpm run dev:renderer
pnpm start
```

仓库没有 lint、package 或 release 脚本，不得声称运行过这些门禁。

### 2.3 最近一次已确认验收

- `pnpm run typecheck` 通过。
- `pnpm test` 通过：4 个测试文件、33 项测试。
- `pnpm run build` 通过：主进程与 renderer 均成功构建。
- 真实 `pnpm start` 冒烟通过，退出后无残留 Electron 和工作区 Node 进程。
- 浏览器 UI 已检查会话流程、历史、规则页和 390×844 窄屏，无水平溢出和控制台警告/错误。
- 本机真实数据库已创建于 `%APPDATA%\xingban-study-partner\xingban.sqlite3`，包含 7 张表，v1 迁移与 `integrity_check` 正常。

这些是历史基线，不替代新改动后的重新验证。自动化测试应使用内存或临时数据库，不能依赖、重置或删除用户的真实数据库。

### 2.4 关键代码地图

| 路径 | 职责 |
| --- | --- |
| `electron/main.ts` | 窗口、托盘、权限、IPC 注册和应用生命周期 |
| `electron/preload.ts` | renderer 可访问的最小 IPC 接口 |
| `electron/session/service.ts` | 主进程会话服务、检查点和数据库协作 |
| `electron/storage/database.ts` | SQLite 迁移、会话、历史、规则和伙伴进度 |
| `electron/partner-pack/validator.ts` | 伙伴包 Schema、路径、哈希与媒体安全校验 |
| `shared/session.ts` | 会话共享类型和 renderer API 契约 |
| `shared/session-engine.ts` | 可测试的纯会话状态机 |
| `shared/rules.ts` | 允许/禁止规则共享类型 |
| `src/hooks/useSessionController.ts` | renderer 会话控制与浏览器回退 |
| `src/App.tsx` | 主界面编排 |
| `src/OverlayView.tsx` | 巡查悬浮窗 |
| `schemas/partner-pack.v1.schema.json` | 伙伴包机器校验协议 |
| `examples/demo-partner/` | 无第三方 IP 的测试与开发伙伴包 |

## 3. 开工前必须处理的已知差异

以下不是可忽略的“以后再说”，而是阶段 3 的首批 P0 工作：

1. **屏幕权限过宽**：`electron/main.ts` 当前对所有 `media` 权限请求统一放行。这在阶段 1 占位期可运行，但阶段 3 必须改为默认拒绝，只允许专用隐藏截图 `webContents` 在有效的一次性授权上下文中请求必要的显示捕获权限。
2. **检查点频率漂移**：`docs/03-system-architecture.md` 写每 30 秒保存，当前服务实际按阶段变化及约每 5 秒的专注时间保存。先决定并统一实现、测试与文档；为降低崩溃丢失，建议保留当前约 5 秒策略并修正文档。
3. **恢复语义漂移**：架构文档写“启动时标记为 `interrupted`”，当前实现会把最近活动快照恢复成暂停的 `focusing` 或 `break`，并设置 `recoveredFromCheckpoint: true`。建议以当前安全、可继续的暂停恢复行为为准，更新文档；只有用户放弃恢复时才无评价关闭为 `interrupted`。
4. **`StartSessionInput` 契约漂移**：`docs/06-data-and-ipc.md` 已描述 `captureSourceId`、`visionEnabled`、允许/禁止规则 ID，当前 `shared/session.ts` 仅有伙伴、场景、目标和计划时长。阶段 3 应以向后兼容的可选字段扩展共享类型，并同步更新运行时校验、preload、主进程、浏览器回退和测试。
5. **隐藏窗口只是骨架**：当前没有已验收的 `getDisplayMedia`、单帧缩放、二进制传输、停止共享或内存释放闭环。
6. **内容保护只完成配置**：主窗口与悬浮窗已调用内容保护，但尚未通过真实捕获确认它们不会进入巡查帧。
7. **自动巡查编排缺失**：规则页面可以增删规则，但没有 Windows 前台采样、规则持续匹配或 `InspectionEngine`。
8. **AI 基础设施缺失**：尚无脱敏设置界面、`safeStorage` 秘密存储、兼容 API adapter、严格响应校验和二次确认调度。
9. **伙伴安装范围有限**：当前只支持目录导入；不要在阶段 3 顺手扩展 ZIP。安装包被校验不等于 UI 已完整支持多已安装伙伴切换，若碰到此问题只记录为阶段 5 候选。
10. **工作区可能无 Git 元数据**：执行任何 Git 工作流前先检查 `.git`，不要假设可以依赖 diff、commit 或 reset。

## 4. 阶段 3 总体设计原则

### 4.1 依赖方向

```text
共享契约与运行时校验
  -> ForegroundProbe 接口 + fake
  -> LocalRuleClassifier
  -> CaptureService 接口 + fake
  -> InspectionEngine
  -> SecretStore / VisionAdapter
  -> renderer 设置与状态
  -> Windows、隐私和 25 分钟端到端验收
```

不要让 `SessionEngine` 直接依赖 Win32、Electron 窗口或网络。系统能力通过小接口注入，纯判断逻辑保持可用 Vitest 重放。

### 4.2 判定优先级

1. 当前不在巡查阶段：不采集、不截图、不请求 AI。
2. 本场没有启用任何巡查能力：返回 `uncertain`，不处罚。
3. 前台信息命中持续允许规则：`focused`。
4. 前台信息命中持续禁止规则至少 20 秒：确认 `distracted`。
5. 允许与禁止规则冲突、没有匹配或探针不可用：进入未知流程。
6. 未授权屏幕、捕获已停止、AI 未开启或没有可用配置：`uncertain`。
7. AI `focused` 且置信度 >= 0.70：`focused`。
8. AI `distracted`：15 秒后使用新的单帧再次请求；两次同类结果均 >= 0.80 才确认 `distracted`。
9. 其他结果与所有失败：`uncertain`。

`uncertain` 永远不消耗三次偏航额度。第一帧 AI `distracted` 也不能立即处罚。

### 4.3 数据最小化

- 前台探针主进程只保留最新样本；原始窗口标题只用于当次规则/AI 判断。
- 数据库结构化观察可保存时间、会话 ID、标签、置信度、原因码、耗时、错误码、应用名和标题哈希。
- 不保存完整标题、截图字节、base64、模型原始响应、OCR 文本、用户文件或聊天内容。
- 捕获源 ID、流 track 和截图缓冲区只保留到完成当前操作所需的最短时间。

## 5. 分批实施计划

每个批次完成后独立运行类型检查、全部测试和生产构建。前一批次门禁未通过，不进入下一批次。

### 批次 A：契约收敛与本地判定底座

#### A1. 文档与现实现状收敛

任务：

- 将检查点频率统一为约 5 秒，并说明阶段变化时立即保存。
- 将恢复流程统一为“启动后恢复为暂停快照；继续或无评价关闭”。
- 把 `StartSessionInput` 的阶段 3 字段定义为可选，保证旧调用仍能工作。
- 在 `docs/06-data-and-ipc.md` 固定新增类型、IPC、事件和错误码，再写代码。

退出条件：全文搜索不再出现互相矛盾的 30 秒/5 秒或强制 `interrupted` 描述；类型字段在文档和代码一一对应。

#### A2. 建立共享契约

建议新增或扩展：

- `shared/inspection.ts`
  - `ForegroundSample`
  - `ObservationLabel`
  - `ObservationReasonCode`
  - `InspectionResult`
  - `CaptureStatus`
  - `VisionSettingsView`（绝不含 API 密钥）
- `shared/session.ts`
  - 可选的 `captureSourceId`
  - `visionEnabled`
  - `sendWindowTitle`
  - `allowRuleIds`
  - `blockRuleIds`
- 主进程运行时 validator；拒绝额外字段、超长字符串、未知枚举、非法 URL 和超范围数字。

任务输入上限建议：目标 500 字，进程名 260 字，窗口标题 500 字，规则数量 100，规则模式 260 字。若调整上限，必须在测试和文档中保持一致。

退出条件：共享契约有合法、缺失、未知字段、超长值和错误枚举测试；旧阶段 2 的会话输入仍通过。

#### A3. `ForegroundProbe` 接口与 fake

建议文件：

- `electron/inspection/foreground-probe.ts`
- `electron/inspection/fake-foreground-probe.ts`
- `electron/inspection/foreground-probe.test.ts`

接口至少支持 `start(onSample)`、`stop()`、`getLatest()` 和状态事件。样本含：

```ts
interface ForegroundSample {
  capturedAt: string;
  processName: string;
  windowTitle: string;
  pid: number;
}
```

fake 必须能重放允许、禁止、冲突、无样本、崩溃和恢复序列。主进程和业务逻辑不得依赖真实 Windows 才能测试。

#### A4. `LocalRuleClassifier`

建议文件：

- `electron/inspection/local-rule-classifier.ts`
- `electron/inspection/local-rule-classifier.test.ts`

规则：

- 进程名大小写不敏感，先去除首尾空白；明确文档化是否保留 `.exe`，推荐规范化为不带 `.exe` 再匹配。
- 窗口标题规则按用户声明的精确值或受限通配表达式匹配；不得把规则当任意正则执行。
- 只使用本场选中的、启用的规则 ID。
- allow 与 block 同时命中视为冲突，返回未知，不擅自给某一方更高优先级。
- block 必须在连续样本中累计至少 20 秒；应用切换、缺失样本或冲突会重置累计。
- allow 持续命中可返回 `focused`；没有规则或探针失败返回 `uncertain`。

退出条件：纯单元测试覆盖 5 秒采样下的 0/5/10/15/20 秒边界、应用切换、规则停用、大小写、通配、冲突和探针缺失。

### 批次 B：Windows 前台探针真实实现

#### B1. 实现策略

优先实现一个可随应用打包的、持久运行的 Windows x64 sidecar，通过 Win32 API 获取当前 HWND、PID、进程名和标题，每 5 秒向 stdout 写一行 UTF-8 JSON。

推荐顺序：

1. 先检查现有环境是否具备可重复构建的 .NET SDK。
2. 若具备，优先使用小型 C# 单文件、自包含 Windows x64 sidecar；固定构建命令与产物路径。
3. 若缺少工具链，不得静默下载或安装。先保留 fake 与 adapter，向用户报告工具链需求并申请许可。
4. PowerShell + P/Invoke 只能作为开发期验证替身，不得冒充最终可打包 sidecar；避免引入原生 Node addon 或通用 FFI 依赖。

sidecar 输出示例：

```json
{"capturedAt":"2026-08-29T08:00:00.000Z","processName":"code","windowTitle":"study.ts","pid":1234}
```

#### B2. 进程管理与防御

- 每行独立解析，限制单行长度；拒绝额外字段、非法时间、负 PID 和超长文本。
- sidecar stderr 只转换为无敏感信息的错误码，不能把完整标题写入日志。
- 应用退出、会话停止和服务销毁时必须终止 sidecar。
- 意外退出后最多自动重启一次；再次失败进入 `PROBE_UNAVAILABLE`，会话继续且未知巡查不处罚。
- 不持久化原始样本。需要写观察时，用主进程 SHA-256 生成标题哈希。

#### B3. 验证

- parser 与进程管理使用 fake child process 自动化测试。
- Windows 手工检查：普通窗口、中文标题、空标题、UWP/系统窗口、应用快速切换、休眠恢复和 sidecar 被杀死。
- 记录 CPU 基线，目标是非巡查前台采样平均 CPU 低于产品文档中的 1% 目标；未测量不得声称达标。

### 批次 C：显式授权的单帧捕获

#### C1. 捕获源选择

建议新增：

- `electron/capture/capture-service.ts`
- `electron/capture/capture-ipc.ts`
- 专用隐藏 capture renderer 或现有 renderer 的严格隔离入口
- 对应 shared 类型与 fake service

流程：

1. 用户在会话设置中主动点击“选择巡查屏幕”。
2. 主进程通过 Electron 获取可用屏幕/窗口源，向 renderer 只返回显示所需的脱敏摘要。
3. 用户明确选择后，主进程生成一次性授权上下文并绑定专用 capture `webContents` 与 source ID。
4. 专用隐藏窗口建立显示流；主窗口不能直接取得 `MediaStream` 或截图数据。
5. 每场授权独立，应用重启、用户停止共享或会话结束后失效。

不要默认选择第一个屏幕，不要在没有用户动作时自动开始共享，不持久化可复用的捕获授权。

#### C2. 收紧权限

替换当前“所有 media 请求都允许”的 handler：

- 默认拒绝所有媒体权限。
- 仅匹配专用 capture `webContents.id`、预期页面来源、有效会话和未过期授权 token 时放行本次显示捕获。
- 摄像头和麦克风始终拒绝。
- 一次性 token 使用后作废；取消或失败后也作废。
- 检查 Electron 44 实际报告的权限名和显示媒体 handler 行为，写成自动化可测的纯授权判断函数。

#### C3. 单帧流水线

- 只在 `InspectionEngine` 请求时绘制当前视频帧。
- 等比例缩放，最长边 768 px，JPEG quality 0.60。
- IPC 使用 `ArrayBuffer`/`Uint8Array` 等二进制方式，不使用 data URL 或 base64。
- 每次调用只返回一帧；禁止循环编码、录屏或后台缓存。
- 请求结束后清空 canvas、覆写/释放可释放缓冲引用；用户停止共享时立刻停止全部 track。
- 请求并发上限为 1；重复请求合并或返回 `CAPTURE_BUSY`，不能堆积截图。
- 设置总超时；结束、取消、窗口销毁和 stream `ended` 均进入明确状态。

#### C4. 内容保护与真实验证

- 保持主督学室和巡查窗 `setContentProtection(true)`。
- 用用户主动选择的真实屏幕源进行一次巡查截图，确认应用主窗和悬浮窗不会出现在帧中。
- 多显示器、125%/150% DPI、全屏应用和窗口最小化至少各检查一次。
- 验收图只允许临时人工查看；不得把真实巡查帧提交到仓库、测试快照或应用数据目录。

退出条件：取消选择、停止共享、源消失、窗口销毁和编码失败都安全降级；磁盘扫描无 JPEG/PNG/webp/base64 巡查残留。

### 批次 D：`InspectionEngine` 闭环

建议新增：

- `electron/inspection/inspection-engine.ts`
- `electron/inspection/inspection-engine.test.ts`
- `electron/inspection/observation.ts`

职责：

- 接收主进程会话服务的巡查触发，不自行掌握会话计时真相。
- 读取最新前台样本与本场规则，先调用本地 classifier。
- 只有未知且授权条件齐全时调用 CaptureService 与 VisionAdapter。
- 统一映射 `focused`、`uncertain`、`distracted`、原因码、置信度、来源、耗时和安全错误码。
- 负责 AI `distracted` 的 15 秒第二次独立采样；会话暂停、结束、停止共享或应用切换时取消待确认任务。
- 只有最终确认的 `distracted` 才向 SessionEngine 发出偏航事件。
- 将结构化观察交给 DataStore；任何截图字节不能穿过 observation 持久化边界。

原因码固定使用 `docs/05-ai-inspection-privacy.md` 中的白名单：

`allowed_app`、`blocked_app`、`task_related_content`、`entertainment_content`、`private_communication`、`insufficient_evidence`、`capture_unavailable`、`api_unavailable`、`invalid_response`。

退出条件：用 fake probe、fake capture、fake vision 完整重放 allow、block 20 秒、冲突、未知无授权、未知 AI focused、单次 AI distracted、二次确认、两次间应用切换、超时和会话结束。

### 批次 E：设置、秘密与兼容多模态 API

#### E1. 设置与 `SecretStore`

建议新增：

- `electron/settings/settings-service.ts`
- `electron/security/secret-store.ts`
- 对应测试和受限 IPC

脱敏设置可包含：API base URL、模型名、是否发送窗口标题、默认 AI 开关和 `apiKeyConfigured: boolean`。API 密钥本体只交给主进程，使用 Electron `safeStorage` 加密后保存；renderer 只能设置、替换、删除，永远不能读回原文。

若当前平台 `safeStorage.isEncryptionAvailable()` 为 false：拒绝持久化密钥，展示明确降级状态，不回退为明文 SQLite 或文件。

#### E2. URL 与请求安全

- 默认只允许 `https:`；开发测试可显式允许 `http://127.0.0.1` 或 `http://localhost`。
- 拒绝 URL 中的用户名、密码、fragment 和非 HTTP(S) 协议。
- 请求禁止自动跟随跨来源重定向，避免 Authorization 泄漏。
- 设置连接和总超时，建议总超时 8 秒；一次巡查请求失败不自动重试。
- 测试只使用本地 mock server，不访问真实外网。

#### E3. `VisionAdapter`

- 所有网络请求只在主进程发起。
- 单请求输入仅限学习目标、前台应用名、用户允许时的可选窗口标题、规则摘要和一张 JPEG 单帧。
- 使用兼容 Chat Completions 或 Responses 风格中的一种明确协议，不做模糊自动猜测；若需要支持多个协议，以独立 adapter 区分。
- 要求模型只返回 JSON；在主进程严格校验 `label`、`confidence`、`reasonCode`，拒绝额外字段和越界值。
- 不记录完整请求、图像、Authorization、模型原始文本或服务端响应体。
- 200 但 JSON 非法、429、5xx、超时、断网和取消全部映射为 `uncertain` + 安全错误码。

自动化至少覆盖：focused 0.70 边界、focused 0.69、distracted 0.80 边界、未知 label、未知 reasonCode、额外字段、非 JSON、空响应、超大响应、429、500、超时、取消和跨来源重定向。

### 批次 F：UI、托盘与可观察状态

#### F1. 会话设置

扩展现有 `SessionSetupDialog`：

- 可选屏幕源与明确的授权说明；
- 本场 AI 开关；
- 是否发送窗口标题，默认关闭；
- 本场启用的 allow/block 规则；
- API 未配置或捕获不可用时的非阻塞说明。

用户不选择屏幕也可以开工，此时仅使用前台应用规则；不要以 AI 配置为启动会话的强制条件。

#### F2. 会话中状态

主界面显示最小、明确的状态：

- 本地规则巡查中；
- 屏幕共享活动中/已停止；
- AI 已开启/不可用；
- 最近结果与低敏原因；
- 发生降级时“不处罚”的提示。

不要显示完整窗口标题、API 错误响应或截图缩略图。

#### F3. 停止控制

- 主界面提供“停止屏幕巡查”。
- 托盘提供同等能力，即使主窗口隐藏也能立即停止。
- 停止捕获不强制结束学习会话；会话继续使用本地规则或 `uncertain` 降级。
- 会话结束、应用退出和 capture window 崩溃时自动停止共享。

浏览器预览使用 fake capture/fake probe，不能调用不存在的 Electron API。真实系统能力只在 Electron 验收。

### 批次 G：持久化、日志和隐私验证

#### G1. 数据库

先检查 v1 已有表和列，只有确实需要时才新增 migration v2。禁止改写已经执行的 v1 migration 或删除真实数据库。

观察记录必须结构化，建议字段：`session_id`、`observed_at`、`source`、`label`、`confidence`、`reason_code`、`app_name`、`window_title_hash`、`latency_ms`、`error_code`。字段与现有表冲突时优先做兼容映射，不重复建表。

#### G2. 日志脱敏

为日志建立集中 redaction/allowlist，不依赖开发者“记得不打印”：

- 允许：事件名、阶段、标签、置信度、原因码、耗时、错误码。
- 禁止：完整标题、学习目标、API key、Authorization、图像、base64、模型原始响应、OCR、聊天与文件内容。

#### G3. 磁盘证据

端到端完成后扫描应用数据目录、工作区生成物、日志与该次测试临时目录：

- 不存在新生成的 JPEG/PNG/webp 截图；
- 不存在 `data:image` 或大段 base64；
- SQLite 不含完整测试窗口标题、API key 和模型原始响应；
- 流与进程已停止。

仓库原本的 demo 伙伴媒体属于预期资产，扫描时要区分“固定伙伴素材”与“新生成巡查图”，不要误删示例包。

### 批次 H：完整验收

先用加速时钟自动化重放，再用真实 Electron 做短时系统验收；最后才进行 25 分钟人工模拟学习。

25 分钟场景至少包含：

1. 启动原创 demo 伙伴与一个明确目标。
2. 允许应用持续匹配，确认 `focused` 且不调用截图/AI。
3. 无规则页面触发一次 AI focused。
4. AI `uncertain` 提醒但不扣偏航。
5. 明确娱乐内容连续两次高置信度、相隔 15 秒，才确认一次偏航。
6. 中途从托盘停止共享，会话继续且后续未知结果不处罚。
7. 再次授权后继续，主窗与悬浮窗不进入截图。
8. 暂停/恢复、休息与结算正常。
9. 伙伴信赖只更新一次，重复结算不重复累计。
10. 历史只显示结构化结果，磁盘无巡查截图。

## 6. 可勾选任务清单

### P0：阶段 3 必须完成

- [x] S3-001 收敛检查点频率、恢复语义和 `StartSessionInput` 文档差异。
- [x] S3-002 新增 inspection/capture/settings 共享类型与严格运行时校验。
- [x] S3-003 建立 ForegroundProbe 接口、fake、状态和 parser 测试。
- [x] S3-004 实现并打包 Windows x64 sidecar，完成崩溃/重启/停止验证。
- [x] S3-005 实现 LocalRuleClassifier 与 20 秒持续 block 边界测试。
- [x] S3-006 以默认拒绝策略收紧 Electron 媒体/显示捕获权限。
- [x] S3-007 实现显式源选择、一次性授权、单帧缩放与二进制传输。
- [x] S3-008 实现停止共享、源结束、窗口销毁和并发/超时处理。
- [x] S3-009 实现 InspectionEngine 的 local-first 编排。
- [x] S3-010 实现 AI distracted 的 15 秒新帧二次确认与取消逻辑。
- [x] S3-011 实现 safeStorage SecretStore 与脱敏设置 IPC。
- [x] S3-012 实现兼容 VisionAdapter、严格 JSON 校验和失败降级。
- [ ] S3-013 扩展会话设置、状态、主界面停止和托盘停止控制。
- [ ] S3-014 接入结构化 observation 持久化；如需变更则新增 migration v2。
- [ ] S3-015 建立日志 allowlist/redaction 与敏感字段测试。
- [ ] S3-016 完成内容保护、多屏/DPI、停止共享和真实 Electron 验收。
- [ ] S3-017 完成加速端到端与 25 分钟模拟学习验收。
- [ ] S3-018 更新 README、架构、隐私、IPC、测试与路线图的完成状态。

### P1：记录但不要阻塞阶段 3

- [ ] P1-001 已安装伙伴包列表与 UI 多伙伴切换体验。
- [ ] P1-002 ZIP 伙伴包安装与解包安全。
- [ ] P1-003 应用打包器、签名、安装包和自动更新。
- [ ] P1-004 阶段 4 的白厄私有伙伴包制作流程。

## 7. 阶段 3 验收门禁

### 7.1 功能

- [ ] 无屏幕授权也能只靠本地规则完成会话。
- [ ] allow 持续命中为 `focused`，不会截图或请求 AI。
- [ ] block 连续不足 20 秒不处罚，达到 20 秒才确认 `distracted`。
- [ ] 冲突或未知规则只在授权齐全时走单帧 AI。
- [ ] `uncertain`、API 失败和 capture 失败均不消耗偏航次数。
- [ ] AI distracted 需要 15 秒后的新帧二次高置信度确认。
- [ ] 停止共享不结束会话，并立即停止所有 track。
- [ ] 恢复、结算、历史和伙伴信赖幂等不回归。

### 7.2 隐私与安全

- [ ] renderer 无 Node、文件系统、任意网络或通用 IPC 能力。
- [ ] 摄像头和麦克风权限始终拒绝。
- [ ] 显示捕获只对专用 capture 窗口和有效一次性授权放行。
- [ ] API key 不进入 renderer、SQLite、日志或异常消息。
- [ ] 完整窗口标题不持久化。
- [ ] 截图不落盘、不进入日志/历史/崩溃报告，不以 base64 传输。
- [ ] 伙伴包无法影响 API 域名、截图、秘密或网络请求。
- [ ] 主窗与巡查窗不进入真实巡查截图。

### 7.3 可靠性

- [ ] sidecar、capture window、stream 和 API 任一失败时，会话仍可继续或正常结束。
- [ ] sidecar 重启有上限，API 请求有超时且失败不重试截图。
- [ ] 暂停、结束、退出、源消失会取消待处理截图和 15 秒二次确认。
- [ ] SQLite v1 数据可原位升级，真实数据库不被重置。
- [ ] 应用退出后无 Electron、Node、sidecar 或屏幕流残留。

### 7.4 自动化与构建

- [ ] `pnpm run typecheck` 通过。
- [ ] `pnpm test` 全部通过，新用例不依赖真实外网、屏幕或用户数据库。
- [ ] `pnpm run build` 通过。
- [ ] renderer 浏览器交互、窄屏和控制台检查通过。
- [ ] 真实 `pnpm start` 的 Windows/捕获/托盘/秘密冒烟通过。
- [ ] 25 分钟验收记录了实际结果、未测项和磁盘扫描证据。

## 8. 推荐的第一批实际改动

下一位 Agent 的第一个实现回合只做批次 A，不要同时接真实截图或网络：

1. 阅读全部必读文件并重新运行基线门禁。
2. 修正三处已知文档漂移。
3. 新增 `shared/inspection.ts`，扩展 `StartSessionInput` 为向后兼容可选字段。
4. 新增严格 validator 测试。
5. 建立 `ForegroundProbe` interface/fake 与 `LocalRuleClassifier`。
6. 用纯 Vitest 覆盖 20 秒 block、allow、冲突、无样本和 probe 崩溃。
7. 运行 typecheck/test/build，更新本文 S3-001、S3-002、S3-003、S3-005 的真实状态；真实 sidecar 对应的 S3-004 仍保持未完成。

这个批次的价值是先固定安全可测的业务核心。只有它稳定后，才进入真实 sidecar 和捕获权限，避免系统能力与判定规则互相纠缠。

## 9. 每次交付报告模板

下一位 Agent 每完成一个批次，应按以下格式向用户汇报，不得只说“完成了”：

```markdown
## 本批次结果

- 完成：列出真正形成闭环的任务 ID。
- 未完成：列出仍是接口、fake、占位或未做真实验收的部分。

## 主要改动

- `path/to/file`：一句话说明职责变化。

## 验证证据

- `pnpm run typecheck`：通过/失败，关键计数。
- `pnpm test`：通过/失败，测试文件数与测试数。
- `pnpm run build`：通过/失败。
- 浏览器/真实 Electron：实际检查了什么，哪些未检查。
- 隐私扫描：扫描范围与结果。

## 风险与下一步

- 已知风险、外部工具链需求、未验证平台场景。
- 下一批次的任务 ID 与边界。
```

## 10. 立即停止并向用户报告的情况

- 需要安装 .NET、原生编译器、证书或新增大型依赖，但尚未得到用户许可。
- 发现真实数据库迁移失败或需要破坏性重置。
- Electron 44 的捕获权限行为与计划假设不同，无法在默认拒绝下建立专用授权。
- 无法保证截图不落盘、API key 不泄漏或 `uncertain` 不处罚。
- 工作区存在与当前任务重叠、来源不明的用户修改，继续会覆盖它们。
- 真实验收需要使用第三方 IP 素材、真实密钥或扩大到 Obsidian/云服务等范围外系统。

遇到以上情况可以继续完成不受阻的只读诊断、接口和测试工作，但不能绕过边界，也不能把部分实现标记为阶段 3 完成。
