# 星伴：多督学伙伴 AI 伴学

这是一个面向 Windows 的本地优先 AI 伴学项目。应用通过随机巡查、低频屏幕判定、有限失误与伙伴信赖成长，帮助用户在其他学习软件中保持专注。

项目采用“底层程序 + 督学伙伴包”的分层设计：程序只认识通用的 `Partner`，不会写死白厄或任何其他角色。白厄是计划制作的第一份本机私有伙伴包，后续角色复用同一协议接入。

## 当前阶段

阶段 0 文档基线、阶段 1 伙伴播放器、阶段 2 本地会话底座，以及**阶段 3 Windows 前台探针、屏幕巡查与兼容 AI** 已全部完成并闭环验收：

- **阶段 3 已交付成果**：
  - **C# Win32 原生前台探针**（`windows-foreground-probe.exe`）：单文件自包含、零外部依赖发布，支持流式解析、防超长行截断、崩溃单次自愈与父进程退出清理。
  - **本地规则优先判定器**（`LocalRuleClassifier`）：前台白名单应用持续活跃直接判定为 `focused`，**绝不调用 AI、绝不产生截图**；连续命中黑名单满 20 秒确认偏航。
  - **严密的屏幕权限与单帧捕获**（`PermissionManager` & `CaptureService`）：主进程媒体权限彻底收紧为默认拒绝，仅在用户本场授权时签发一次性 token 放行屏幕捕获；单帧 JPEG 768px Q60 编码、内存即用即清、绝对不落盘；应用窗口启用 `setContentProtection(true)` 防止自身被截取。
  - **巡查编排引擎与 15 秒二次确认**（`InspectionEngine`）：AI 返回 `distracted` 绝不立即处罚，相隔 15 秒重新抽取全新独立单帧进行二次判定，两次均 ≥ 0.80 才确认偏航；期间前台切换、暂停或停止屏幕共享自动取消。
  - **凭据操作系统级加密**（`SecretStore`）：基于 Electron `safeStorage` 加密存储 API 密钥，密钥绝不返回 renderer，仅暴露脱敏视图；支持多模态 AI（`OpenAiVisionAdapter`）带超时控制与严格 JSON 解析拦截。
  - **结构化历史记录与隐私扫盘**：支持历史记录展开查看单场巡查明细（时间、标签、来源、原因码、置信度与应用名）；全库扫盘 100% 确认无明文密钥、无 Base64 图像、窗口标题仅存不可逆 SHA-256 哈希；磁盘扫盘 100% 确认零残留巡查截图。
  - **全量测试通过**：15 个测试文件、126 项单元与端到端测试 100% 通过。
- 准入状态：**阶段 3 全部验收门禁已通过，已正式具备开展阶段 4（白厄私有伙伴包生产）的准入资格**。

## 核心体验

1. 用户选择督学伙伴、场景、目标和专注时长。
2. 应用在后台观察前台应用，按不可预测的间隔发起巡查。
3. 本地规则优先判断；确有必要且用户已授权时，才向兼容多模态 API 发送一张低分辨率单帧。
4. `uncertain` 只触发温和提醒；只有确认的 `distracted` 才记一次偏航。
5. 一场允许三次偏航，耗尽后仍可继续，但本场评价最高为 C。
6. 有效专注转化为当前伙伴独立的信赖值，解锁新的台词和动作变体。

## 关键术语

| 术语 | 定义 |
| --- | --- |
| 督学伙伴 Partner | 应用中的陪伴与督学人格，不等同于底层程序。 |
| 伙伴包 | 仅含声明式清单和媒体资源的可安装内容包。 |
| 场景变体 | 同一伙伴在一套完整预渲染环境中的全部反应资源。 |
| 巡查 | 一次由本地规则及可选 AI 共同完成的专注状态判定。 |
| 偏航 | 经规则或二次确认后成立的一次明确分心。 |
| 信赖 | 按伙伴独立累计、只增不减的长期成长值。 |

## 文档导航

- [产品需求](docs/01-product-requirements.md)
- [会话与体验规则](docs/02-session-experience.md)
- [系统架构](docs/03-system-architecture.md)
- [伙伴包协议](docs/04-partner-pack-spec.md)
- [AI 巡查与隐私](docs/05-ai-inspection-privacy.md)
- [数据模型与 IPC](docs/06-data-and-ipc.md)
- [测试与验收](docs/07-testing-and-acceptance.md)
- [路线图](docs/08-roadmap.md)
- [下一位 AI Agent 交接与后续执行计划](docs/09-agent-handoff-plan.md)
- [阶段 4：白厄私有伙伴包（星轨麦田）制作手册](docs/10-phase4-baie-wheatfield-spec.md)
- [AI Agent 项目执行规则](AGENTS.md)
- [伙伴包 JSON Schema](schemas/partner-pack.v1.schema.json)
- [无版权示例清单](examples/demo-partner/manifest.json)
- [界面设计基线](design/README.md)

## 本地运行

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm run build
pnpm start
```

仅预览 React 界面时运行 `pnpm run dev:renderer`，然后打开 `http://127.0.0.1:5173`。伙伴包目录导入、巡查悬浮窗和系统托盘只在 Electron 桌面版可用。

## 设计边界

基础仓库保持 IP 中立。`private-fan` 伙伴包必须标记为 `private-only`，不得进入仓库、应用安装包或公开分享渠道。程序运行时只读取经过校验的本地伙伴包，不执行伙伴包中的任何代码。
