# 下一位 AI Agent 交接与后续执行计划

> 基线日期：2026-08-31
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
- 自动更新、公开发布或商业化；通用 ZIP 安装按第 7.2 节的 N2 例外路线执行；
- 为未来功能提前重构整个 UI 或替换现有技术栈。

## 2. 已验证的项目基线

### 2.1 已完成范围

| 阶段 | 已完成内容 | 当前状态 |
| --- | --- | --- |
| 阶段 0 | 中文规格、伙伴包协议、JSON Schema、原创示例包 | 已完成 |
| 阶段 1 | Electron 多窗口、托盘、受限 preload、示例伙伴播放器和文件夹导入校验 | 已完成 |
| 阶段 2A | 会话纯状态机、计时、暂停/恢复、随机巡查、三类判断、三次偏航、休息、等级和信赖 | 已完成 |
| 阶段 2B | SQLite、活动会话检查点、安全恢复、历史、关系进度、允许/禁止规则管理 | 已完成 |
| 阶段 3 | Windows 前台探针、自动规则判断、真实单帧捕获、兼容 AI | 进行中；真实捕获、隐私门禁和 G3-A 隔离验收辅助已通过，剩余环境矩阵和 25 分钟人工场 |

现有实现能够运行 10～180 分钟会话，Electron 主进程掌握权威时间，浏览器预览与主进程共用纯状态机。主督学室、置顶巡查窗、隐藏截图工作窗、托盘和真实安全捕获链路均已落地并在当前单屏 100% DPI 环境通过短时桌面验收；这仍不等于多屏/DPI/休眠矩阵或 25 分钟人工场已经完成。

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
pnpm run build:probe
pnpm run dev:renderer
pnpm start
pnpm run acceptance:stage3:preflight
pnpm run acceptance:stage3
pnpm run diagnose:stage3:startup
pnpm run rehearse:stage3:b1
```

仓库没有 lint、package 或 release 脚本，不得声称运行过这些门禁。

### 2.3 最近一次已确认验收

> 2026-09-02 复核（B0 批次）：类型检查、生产构建与全部测试重新通过；`docs/11` 的 B0 已关闭。

- `pnpm run typecheck` 通过。
- `pnpm test` 通过：30 个测试文件，209 项通过、1 项默认跳过（真实 sidecar 专项）。
- `pnpm run build` 通过：主进程与 renderer 均成功构建。
- `pnpm run build:probe` 通过；`resources/bin/windows-foreground-probe.exe` 为 12,503,176 字节，SHA-256 为 `C40DFCFFF5EDFCB1605A65DBB25651854F6EF1D786B0D3AF0F0B5B9219FE9C27`。
- 设置 `XINGBAN_REAL_PROBE_TEST=1` 后，真实 Windows 探针专项 6 项全部通过，结束后 sidecar 进程数为 0。
- 真实桌面权限下的 `pnpm start` 短时冒烟无启动错误；发送 SIGINT 退出后，Electron、sidecar、Vite 监听和工作区 Node 进程数均为 0。受限沙箱中的 `ProcessSingleton`/DPAPI 错误不计作真实桌面验收。
- 浏览器 UI 已检查主界面、会话设置、规则/AI 设置和 390×844 窄屏；默认不共享、目标 500 字上限、密钥不回显、无水平溢出和控制台警告/错误均通过。
- 本机数据库 `%APPDATA%\xingban-study-partner\xingban.sqlite3` 仍为 7 张表，`integrity_check=ok`；应用数据目录无图片/可疑巡查文件，文本和 SQLite 中的截图 base64 命中均为 0。
- 用户主动选择真实屏幕后，媒体流可以建立并从主界面停止；退出后 Electron、sidecar、Vite 和工作区 Node 均为 0，应用数据与近两小时临时目录没有截图候选。该轮日志暴露的桌面手工巡查竞态已经通过移除手工按钮及对应 preload/IPC 修复。
- 真实内容保护单帧为 768×432；青/黄原生对照各为 37,602/37,734 像素，受保护品红/绿色标记为 0/1 像素，硬阈值为 497，结果为 `passed`。取帧后流、Electron 与 sidecar 均已停止，应用数据、SQLite 和近三小时相关临时目录的截图/base64 复扫均为 0。
- G3-A 隔离验收辅助已经落地：随机临时 `userData` 在主进程与启动器两侧校验为系统临时目录的直接子目录；本机 mock AI 只监听 `127.0.0.1` 随机端口并只接受固定假令牌、固定模型与不含标题的严格形状；固定巡查节点按实际 `patrolCount` 推进，避免恢复反馈跳过节点；退出后核对低敏 8 步轨迹/SQLite 判据、全量流式零图片/data-image/假令牌扫描并删除精确目录。自动预检不能替代真实 Electron 或真实中断清理。
- 会话中新增显式重新授权入口：renderer 只能在活动会话中再次请求脱敏屏幕列表并提交用户刚选择的 source ID；主进程重新执行一次性授权与源存在性校验。正式模式仍默认不共享且保持随机巡查。
- 真实操作暴露的阻断式反馈已收口：中途 `feedback` 由主进程在 5 秒后幂等回流到 `focusing`，计划完成后的结算反馈不自动跳过；置顶巡查窗同样由主进程 5 秒自动隐藏，新结果重置倒计时，用户无需返回主窗点击继续。

这些是历史基线，不替代新改动后的重新验证。自动化测试应使用内存或临时数据库，不能依赖、重置或删除用户的真实数据库。

### 2.4 关键代码地图

| 路径 | 职责 |
| --- | --- |
| `electron/main.ts` | 窗口、托盘、权限、IPC 注册和应用生命周期 |
| `electron/preload.ts` | renderer 可访问的最小 IPC 接口 |
| `electron/session/service.ts` | 主进程会话服务、检查点和数据库协作 |
| `electron/storage/database.ts` | SQLite 迁移、会话、历史、规则和伙伴进度 |
| `electron/acceptance/stage3-environment.ts` | 隔离路径、回环 mock 配置、固定种子与验收会话约束 |
| `electron/acceptance/mock-vision-server.ts` | 不记录请求体的本机脚本化兼容 AI |
| `electron/acceptance/stage3-evidence.ts` | 低敏数据库判据、零残留扫描和精确目录清理 |
| `electron/acceptance/stage3-run-trace.ts` | 8 步观察、停止/重授权、暂停/恢复与结算轨迹的严格门禁 |
| `scripts/run-stage3-acceptance.mjs` | 真实 25 分钟场的外层进程、mock 与清理编排 |
| `electron/partner-pack/validator.ts` | 伙伴包 Schema、路径、哈希与媒体安全校验 |
| `shared/session.ts` | 会话共享类型和 renderer API 契约 |
| `shared/session-engine.ts` | 可测试的纯会话状态机 |
| `shared/rules.ts` | 允许/禁止规则共享类型 |
| `src/hooks/useSessionController.ts` | renderer 会话控制与浏览器回退 |
| `src/App.tsx` | 主界面编排 |
| `src/OverlayView.tsx` | 巡查悬浮窗 |
| `schemas/partner-pack.v1.schema.json` | 伙伴包机器校验协议 |
| `examples/demo-partner/` | 无第三方 IP 的测试与开发伙伴包 |

## 3. 已收口差异与剩余门禁

本轮自动化收口已经完成：检查点/恢复文档统一、`StartSessionInput` 严格校验、真实采样时间累计、默认不选屏、专用 display-capture 一次性授权、窗口 preload 与 IPC sender 隔离、单帧缩放/清理、AI 严格 URL/响应边界、15 秒二次确认和真实 `SessionService` 回写。自动巡查只写一条结构化 observation，不再重复生成手工记录。

巡查判定政策 v1 已固定目标上下文、应用中立、标签/原因码语义和私人通讯边界：默认私人通讯只提醒，严格模式才允许进入 15 秒两帧确认；模型不能伪造本地规则原因码。完整口径见 `docs/10-inspection-decision-policy.md`。

真实系统基础也已确认：Windows sidecar 完成可重复自包含构建、开发/生产路径解析、显式真实探针测试与退出清理；Electron 默认用户数据目录在真实桌面权限下可以短时启动并完整退出。应用安装包、签名与发布仍归 P1-003，不作为阶段 3 的前置门禁。

仍不得标记阶段 3 完成，原因如下：

1. 主窗口与悬浮窗的内容保护已通过应用生成的真实 768×432 单帧验证；原生对照窗可见而两者的受保护标记不在帧内，该项不再是阻塞门禁。
2. 临时假密钥的真实 `safeStorage` 保存、数据库重开解密、清除和再次重开确认已通过，且未触碰用户数据库；该项不再是阻塞门禁。
3. 当前机器只提供单显示器与 100% 系统 DPI；多显示器需要真实第二块屏幕，125%/150% DPI 需要用户同意修改系统缩放。当前机器可执行但尚未完成的全屏应用、系统停止共享、捕获窗销毁和休眠恢复也仍属人工门禁。
4. 真实单帧取帧、媒体流停止并退出后的应用数据、近三小时临时目录与 SQLite 零截图/base64 扫描已通过；25 分钟人工模拟学习仍未完成。
5. G3-A 隔离验收辅助与自动预检已完成，但其绿色结果不能替代真实 Windows 前台探针、真实屏幕流连续运行满 25 分钟的 G3-B 人工场。

N2 已支持 ZIP 与目录导入，按用户批准的非 B 路线提前完成通用安装安全；通用多伙伴原型也不等于私有伙伴包已验收。工作区有 Git 元数据，当前主线分支为 `master`；每次接手仍必须实时检查分支、工作树与远端状态，保留用户或其他 Agent 的现场修改，不得把本文中的历史描述当成提交、推送或外部交付证据。

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

当前输入上限：目标 500 字，进程名 260 字，窗口标题 500 字，规则数量 100，规则模式 200 字。

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

1. 会话设置默认不枚举屏幕；用户主动点击“加载可用屏幕”。
2. 主进程通过 Electron 获取可用屏幕源，向 renderer 只返回显示所需的脱敏摘要。
3. 用户明确选择后，主进程生成一次性授权上下文并绑定专用 capture `webContents` 与 source ID；最终 display-media handler 重新枚举一次以确认源仍存在，启动路径不做第三次重复枚举。
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
3. 禁止规则连续命中 20 秒，确认一次本地规则偏航。
4. 无规则页面触发一次 AI `focused`。
5. 默认私人通讯返回 `uncertain`，提醒但不扣偏航。
6. 明确娱乐内容连续两次高置信度、相隔 15 秒，才确认一次 AI 偏航。
7. 中途从托盘停止共享，会话继续且后续未知结果不处罚。
8. 再次授权后继续，并完成暂停/恢复、休息与结算。
9. 伙伴信赖只更新一次，重复结算不重复累计。
10. 历史只显示结构化结果，磁盘无巡查截图。

## 6. 可勾选任务清单

### P0：阶段 3 必须完成

- [x] S3-001 收敛检查点频率、恢复语义和 `StartSessionInput` 文档差异。
- [x] S3-002 完成 inspection/capture/settings 共享类型与严格运行时校验。
- [x] S3-003 建立 ForegroundProbe 接口、fake、状态和 parser 测试。
- [x] S3-004 完成 Windows x64 sidecar 的可重复自包含构建、开发/生产路径解析、崩溃/停止与真实进程清理验证。
- [x] S3-005 修正 LocalRuleClassifier，使 20 秒 block 来自连续 5 秒样本而非随机巡查调用次数。
- [x] S3-006 以默认拒绝和主进程强制选源收紧 Electron 显示捕获权限；真实 Electron 行为仍归 S3-016 验收。
- [x] S3-007 实现默认不共享、用户显式选源、一次性授权、流就绪确认、单帧缩放与二进制 IPC。
- [x] S3-008 实现停止共享、源结束、窗口销毁和并发/超时处理，并使迟到 AI 结果失效。
- [x] S3-009 修复 InspectionEngine 与真实 SessionService 的 local-first 编排及单条结构化持久化。
- [x] S3-010 修复 AI distracted 的 15 秒新帧二次确认与最终会话回写。
- [x] S3-011 `safeStorage` SecretStore 已用临时假密钥完成真实桌面保存、重开解密、清除与再次重开验证，不回退明文且不触碰用户数据库。
- [x] S3-012 补齐 VisionAdapter 的 URL、重定向、响应长度、严格 JSON 和失败降级。
- [x] S3-013 收紧各窗口 preload 与 IPC sender，并完善会话状态和停止控制。
- [x] S3-014 结构化 observation 使用现有 v1 表持久化，不修改既有迁移语义。
- [x] S3-015 已有日志脱敏与敏感字段自动化基础。
- [ ] S3-016 完成内容保护、多屏/DPI、停止共享和真实 Electron 验收（真实选源、单帧内容保护、应用内停止与既有清理证据已通过；多屏、125%/150% DPI、全屏、系统级停止共享、截图窗销毁和休眠恢复仍待验证）。
- [ ] S3-017 完成真实主进程集成测试、加速端到端与 25 分钟模拟学习验收（前两项及 G3-A 隔离验收辅助已自动化，25 分钟人工场仍待验收）。
- [ ] S3-018 在所有证据齐全后更新完成状态；当前不得提前勾选。

### P1：通用 N 组可提前开发，私有包与最终发布仍需阶段 3 通过

- [ ] P1-001 验收通用多伙伴列表、选择、媒体协议与关系进度隔离。
- [x] P1-002 ZIP 伙伴包安装与解包安全（N2，2026-09-05；自动门禁与隔离 Electron 冒烟通过，原生选择器使用测试替身；崩溃边界见包协议第 10 节）。
- [ ] P1-003 应用打包器、签名、安装包和自动更新。
- [ ] P1-004 在本机私有目录生产和验收首个第三方角色伙伴包；仓库与测试继续保持 IP 中立。

## 7. 阶段 3 当前验收状态与关闭计划

2026-09-08 排期更新：用户明确要求恢复 B2～B5 真实验收并授权自动桌面操作，覆盖下文 2026-09-03 的冻结安排。按 B2 → B3 → B4 → B5 推进，N3/N4 保持未完成；选屏仍由用户主动完成，DPI 与多屏按实际授权和硬件记录。18:00 节点须保持未知应用，由 mock AI 返回 focused，不能用允许规则跳过重新授权后的取帧验证。

### 7.0 B0 已完成（2026-09-02）

启动稳定性诊断已通过：连续 3 次随机隔离 `userData` 冷启动全部到达会话设置界面（3.5～4.0 秒），
子进程崩溃 0、探针失败 0、进程清理、隐私扫描与精确目录清理全部通过。

该批次定位并修复了三条启动根因，详见 `docs/11-stage-3-completion-plan.md` 第 6.4 与 6.5 节：

1. Agent 外壳注入的 `ELECTRON_RUN_AS_NODE=1` 使 Electron 以纯 Node 运行（两个 runner 已自动剔除该变量并新增 `runtime` 判据）；
2. Electron 44 的 `loadFile()` 不对非 ASCII 路径百分号编码，中文工作区下三个窗口全部 `ERR_FAILED (-2)`（`loadRenderer()` 已改为 `pathToFileURL()` + `loadURL()`）；
3. 沙箱化外壳会反复杀死 GPU 进程，**B1 及之后所有真实 Electron 验收必须在非沙箱真实桌面会话中执行**。

以上三条都会表现为此前记录的 “GPU/renderer `launch-failed`”。它们不解除任何剩余门禁：
G3-B（真实 25 分钟人工场）与 G3-C～G3-G 仍未取得证据，阶段 3 不得标记完成。

### 7.1 B1 预演已通过（2026-09-02）

`pnpm run rehearse:stage3:b1` 已实现并通过：只判定 2:00 允许规则与 3:00 连续禁止规则两个节点，
任一不符立即终止并输出低敏诊断（`processMatch / localVerdict / localReason`），不等待完整 25 分钟。
两个节点还必须分别满足 `patrolCount/deviationCount = 1/0、2/1`；完成后由主进程正常退出，
捕获与探针关停回执、Electron 退出码、GPU 零崩溃、隔离、mock、隐私扫描和精确清理均参与通过判定。
B1 阶段出现任何 mock AI 请求即失败。

**同日修复的产品缺陷**：`LocalRuleClassifier` 的 block 连续累计在跨过 20 秒阈值后立即重置，
导致固定巡查节点几乎必然读到 `block_duration_insufficient`。修复后跨过阈值作为状态锁存，
详见 `docs/11-stage-3-completion-plan.md` 第 6.7 节。

B1 已通过。用户于 2026-09-03 决定把 B2～B5 延期到通用应用代码完成后的最终关闭阶段；N1、N2 已完成，下一步不进入 B2，继续执行下述 N3～N4 非 B 开发路线。

### 7.2 B 组延期与后续开发计划（2026-09-03）

- B2～B5 全部冻结；不得再启动 25 分钟人工场、环境矩阵或阶段关闭复验，直到 N1～N4 完成。
- 阶段 3、S3-016～S3-018 继续保持未完成；自动测试或代码完成不能替代真实 B 证据。
- N1（2026-09-03 已完成）：用两份原创中性伙伴夹具收口 P1-001 的通用列表、选择、场景、动作降级和关系进度隔离；伙伴 ID 在 IPC/媒体协议入口按 Schema 校验，会话中禁止切换伙伴、场景或导入伙伴包。
- N2（2026-09-05 代码与非 B 验证已完成）：P1-002 ZIP/目录安装共用 Schema、路径、资源与文件校验，同版本不覆盖，新版本登记失败撤回；281 项测试通过，真实隔离 Electron 导入/媒体/重启及 pnpm start 冒烟通过。详见 docs/04 第 10 节与 docs/07。
- N3：推进 P1-003 的 Windows 本地打包准备；任何新增打包工具链、证书、签名或更新服务都需单独授权。
- N4：完成通用应用代码审计与全部非 B 自动门禁，生成最终 B2～B5 清单。
- 最终关闭：按 B2 → B3 → B4 → B5 回补真实证据；全部通过后才能关闭阶段 3 并开始 P1-004 私有伙伴包生产。

本次 B2 尝试未形成通过证据，但在 8:00 私人通讯节点发现一个真实实现差异：经默认隐私策略归一化后的有效 AI 提醒被误记为 `fallback`。现已在 `InspectionEngine` 根路径保留其 `vision-api` 来源并补测试；全量 32 个测试文件中 223 项通过、1 项默认跳过，类型检查和生产构建通过。该修复不等于 B2 通过。


2026-09-01 已重新执行本批自动门禁：29 个测试文件中 198 项通过、1 项默认跳过；真实 sidecar 专项 6 项、类型检查、生产构建与完整 G3-A 自动预检通过，浏览器桌面/390×844 会话启动、巡查反馈和控制台 QA 也已通过。`pnpm start` 三次真实启动主窗成功，SIGINT 结束后排除 Codex 自身计算机控制运行时，本工作区 Electron、Node 与 sidecar 为 0；这只证明强制中断冒烟，不证明托盘正常退出或媒体轨回执。用户主动选源后的媒体流建立/停止、零截图残留、`safeStorage` 和 768×432 内容保护证据仍有效。新 G3-A 自动结果不能代替真实屏幕流连续运行。阶段 3 仍不能标记完成，因为真实 25 分钟人工场，以及全屏/系统停止/截图窗销毁、休眠、DPI、多屏与最终关闭复验尚未取得完整证据。

2026-09-01 对非打断反馈修复执行了隔离 Electron 短时冒烟：主窗触发预览后目标应用可见窗口数 `1 → 2`，等待 6 秒后回到 `1`；随后中断 runner，项目进程和验收临时目录均为 0。该结果证明真实巡查窗会自动隐藏，但不是完整 G3-B 通过证据。

同日的 G3-B 长场尝试在 2:00 本地允许节点通过，但 3:00 禁止节点未满足连续 20 秒本地命中，相关无效场均中断并完成隐私扫描与精确清理。验收模式已补充只输出规则类别和本地分类原因的低敏诊断，不输出原始应用名或窗口标题。最后一次重启在会话前发生 GPU/renderer `launch-failed`，runner 仍确认子进程退出、隐私扫描通过并删除隔离目录。用户随后决定跳过剩余复合验收；G3-B～G3-G 不得标为通过。

重新验收至少包括：默认不共享、本地规则连续 20 秒、AI 15 秒二次确认、截图窗口 sender 隔离、HTTPS/本机 URL 限制、API 失败不处罚、流/sidecar/进程清理、真实内容保护截图与磁盘零残留。

下一批不直接开始角色生产，也不执行 B 组验证，按 `docs/11-stage-3-completion-plan.md` 推进 N3 Windows 本地打包准备（新增工具链仍须单独授权）。N3～N4 完成后，再按 B2～B5 回补真实证据；未全部通过时不得勾选 S3-016～S3-018 或开始 P1-004。

## 8. 当前接手边界

2026-09-08 最新交接：用户确认手工完成 B2，授权继续 B3。B2 人工确认与本次仅到 885 秒的自动记录分开保存；不得补写自动通过结论。B3 逐项证据与独立辅助命令见 docs/11 第 5 节，历史冻结安排已由本次用户指令覆盖。

- 可保留：阶段 0～2、伙伴包通用协议、数据库 v1、Windows sidecar 与阶段 3 各接口的现有实现基础。
- 已完成自动化修正：显式授权、连续采样、AI 二次确认、IPC/网络安全和真实桌面基础启动。
- G3-A 验收辅助与隔离环境已经完成自动门禁；N1 多伙伴公共底座已完成，B2～B5 按用户决定冻结到通用应用代码完成后的最终关闭阶段。N2 ZIP 安装安全已完成代码与非 B 验证，下一批执行 N3 Windows 本地打包准备，不运行 25 分钟人工场或环境矩阵。应用单帧内容保护和取帧后隐私复扫已经通过，不要重复要求用户单独授权；真实 runner 中断清理仍在最终 G3-G 复验。
- 通用多伙伴切换代码只能标记为未验收原型，不代表阶段 4 已完成。
- 第三方角色的制作脚本、台词、媒体和专用测试不得进入通用仓库；只允许保存在 `.gitignore` 排除的本机私有目录。
- 后续 Agent 接手时先实时核对 `git status`、当前分支和远端提交；文档中的验收基线不能替代仓库现场证据。


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
