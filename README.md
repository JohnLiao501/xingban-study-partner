# 星伴：多督学伙伴 AI 伴学

这是一个面向 Windows 的本地优先 AI 伴学项目。应用通过随机巡查、低频屏幕判定、有限失误与伙伴信赖成长，帮助用户在其他学习软件中保持专注。

项目采用“底层程序 + 督学伙伴包”的分层设计：程序只认识通用的 `Partner`，不会写死白厄或任何其他角色。白厄是计划制作的第一份本机私有伙伴包，后续角色复用同一协议接入。

## 当前阶段

阶段 0 文档基线、阶段 1 伙伴播放器和阶段 2 本地会话底座已经完成：

- 已建立 Electron 44、React、TypeScript、Vite 工程骨架。
- 已实现原创 demo 伙伴包、十类动作媒体预览与字幕降级。
- 已实现主窗口、巡查悬浮窗、隐藏截图工作窗、托盘和受限 preload。
- 已实现伙伴包 Schema、语义关联、路径、签名、大小与 SHA-256 校验。
- 已实现 10～180 分钟会话、权威计时、暂停/继续、随机巡查与手动巡查验收入口。
- 已实现 `focused`、`uncertain`、`distracted` 三类反馈；不确定不处罚，确认分心才消耗三次偏航额度。
- 已实现五分钟恢复反馈、休息邀请、S～D 评价、偏航上限和信赖增量公式。
- Electron 主进程维护权威会话状态；浏览器视觉预览复用同一套纯状态机。
- 已使用 Electron 自带 SQLite 保存会话检查点、结构化历史、本地允许/禁止规则和按伙伴隔离的信赖。
- 异常退出后的未完成会话会以暂停状态恢复，由用户决定继续或结束，不会擅自生成评价。
- “历史”和“规则”页面已经可用；数据库结算具有幂等保护，不会因重试重复增加信赖。
- 不包含白厄或其他第三方 IP 素材。
- Windows 前台应用探针、规则自动判断、屏幕巡查和 AI 仍在下一阶段；继续不接入 Obsidian、账号、云同步或摄像头。

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
