# 系统架构

## 1. 技术基线

- Electron 44.x，固定到锁文件中的具体补丁版本。
- React + TypeScript + Vite 构建界面。
- Electron 内置 Node 24 的 `node:sqlite` 管理本地数据库。
- Windows x64 为唯一 MVP 目标；要求 Windows 10 2004 或更高版本。

## 2. 进程与窗口

### 2.1 Electron 主进程

唯一可信协调层，负责：

- 窗口、托盘和应用生命周期。
- SQLite 与迁移。
- 伙伴包安装、校验和媒体路径解析。
- 会话状态机、巡查调度、偏航与信赖计算。
- 兼容 API 请求与密钥读取。
- Windows 前台探针子进程管理。

### 2.2 主督学室窗口

显示伙伴与场景选择、会话配置、计时、当前偏航额度、结算、历史和设置。关闭窗口默认最小化到托盘；存在活动会话时不直接退出。

### 2.3 巡查悬浮窗

默认 420×236、可拖动、置顶，仅在反应时显示。窗口启用内容保护，使其不进入 Electron/Windows 的正常屏幕捕获结果。非交互播放期间鼠标穿透；鼠标移入控制区时恢复交互。

### 2.4 隐藏截图工作窗

拥有 `getDisplayMedia` 产生的屏幕流，设置 `backgroundThrottling: false`。巡查时把当前帧绘制到 `OffscreenCanvas`，缩放后以可转移缓冲区交给主进程，随即清空画布和缓冲区引用。

### 2.5 Windows 前台探针

自包含 sidecar，每 5 秒调用 Win32 API 获取前台 HWND、进程名和窗口标题，通过标准输出发送单行 JSON。主进程只持有最新值；数据库最多保存 `appName` 与不可逆的 `windowTitleHash`。

## 3. 模块边界

```text
Renderer UI
   | validated IPC
Main Process
   +-- SessionEngine ------ PatrolScheduler
   +-- InspectionEngine --- LocalRuleClassifier
   |                     +-- VisionClassifierAdapter
   +-- PartnerPackService - ManifestValidator / MediaResolver
   +-- DataStore ---------- node:sqlite
   +-- SecretStore -------- Electron safeStorage
   +-- WindowCoordinator -- main / overlay / capture
   +-- ForegroundProbe ---- Windows sidecar
```

渲染器只能通过 preload 暴露的最小 API 访问能力；`nodeIntegration` 关闭，`contextIsolation` 开启，不向渲染器暴露数据库、文件系统、密钥或任意网络请求。

## 4. 巡查数据流

1. `ForegroundProbe` 提供当前进程和标题。
2. `LocalRuleClassifier` 返回明确结果或未知。
3. 未知且会话已授权时，`SessionEngine` 请求截图工作窗产生一张最长边 768 px 的 JPEG。
4. 主进程调用 `VisionClassifierAdapter`；API 密钥只在主进程解密。
5. 响应经严格 JSON 校验后交给确认策略。
6. 原始图像缓冲被覆盖或释放，仅结构化 `Observation` 写入 SQLite。
7. `WindowCoordinator` 根据动作键请求巡查窗播放伙伴资源。

## 5. 伙伴包安装

安装顺序固定为：

1. 将压缩包复制到随机临时目录，不在原位置执行或打开媒体。
2. 拒绝绝对路径、盘符、`..`、符号链接、脚本与可执行扩展名。
3. 按 JSON Schema 校验清单，再执行跨字段和媒体探测校验。
4. 校验每个 `files` 条目的大小与 SHA-256，并确认所有媒体均在文件清单中。
5. 以原子目录替换方式安装到应用数据目录的 `partners/<partnerId>/<packVersion>/`。
6. 同一 `partnerId + packVersion` 默认拒绝覆盖，必须先显式卸载旧包。

## 6. 故障与恢复

- 主进程在阶段变化时立即保存检查点，专注期间约每 5 秒保存一次，以降低崩溃丢失。
- 下次启动发现未终结会话时恢复为暂停状态的快照（`focusing` 或 `break`），由用户决定继续或无评价关闭为 `interrupted`。
- 屏幕流终止时暂停 AI 巡查，但本地前台规则仍可运行；界面明确显示降级状态。
- API 失败不重试截图判定，直接返回 `uncertain`，避免重复上传同一画面。
- 媒体失败按“视频 → 字幕+音频 → 纯字幕”降级，不影响会话状态机。

## 7. 安全默认值

- CSP 禁止远程脚本、`eval` 和非白名单网络目的地。
- 兼容 API 的 `baseUrl` 只能由设置页保存，伙伴包不能修改。
- 日志对目标、标题、路径和响应内容做脱敏。
- 伙伴包是纯数据，不提供插件钩子、HTML、CSS 或 JavaScript。
