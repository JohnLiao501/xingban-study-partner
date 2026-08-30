# AI 巡查与隐私

## 1. 原则

1. 本地规则优先，AI 只处理本地无法确定的巡查。
2. 屏幕捕获按场授权，停止共享立即生效。
3. 单帧最小化：不发送连续视频、麦克风、剪贴板或键盘内容。
4. 无法证明分心时不处罚。
5. 应用不保存截图，日志和数据库只保留结构化结果。
6. 伙伴包无权更改 API、捕获或隐私设置。

## 2. 数据分类

| 数据 | 位置与生命周期 |
| --- | --- |
| API 密钥 | 使用 Electron `safeStorage` 加密，只在主进程请求时短暂解密。 |
| 学习目标 | 本地 SQLite；AI 开启时会随单帧发送。 |
| 前台应用名 | 内存；结构化观察可保存。 |
| 窗口标题 | 默认仅在内存；数据库只存哈希；默认不发送给 API。 |
| 屏幕单帧 | 内存中缩放、编码、判定后释放；不落盘。 |
| AI 原始响应 | 主进程内解析后丢弃；只保存标签、置信度与原因码。 |
| 伙伴媒体 | 本地伙伴包目录；不上传到判定 API。 |

## 3. 单帧生成

- 仅在巡查阶段、本地规则未知、存在捕获源且用户为本场开启 AI 时生成。
- 最长边缩放到 768 px，保持宽高比，JPEG 质量 60。
- 不请求系统音频、摄像头或麦克风；鼠标指针是否进入系统显示流取决于 Windows 捕获行为，不作为当前已验证承诺。
- 巡查悬浮窗与主应用窗启用内容保护，避免递归进入单帧。
- 编码缓冲只通过专用二进制 IPC 送达主进程，不使用 data URL；renderer 与主进程在各自处理完成后覆写可释放的 `Uint8Array`。

## 4. 兼容 API 配置

首个适配器采用 OpenAI-compatible 多模态接口。配置项为：

```ts
interface VisionSettingsView {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean; // 只返回是否已配置，不返回密钥
  sendWindowTitle: boolean; // 默认 false
  visionEnabled: boolean;
  timeoutMs: number;        // 2000～60000，默认 10000
}
```

保存设置时可额外短暂提交 `apiKey` 或 `clearApiKey`；密钥字段在 renderer 提交结束后立即清空，主进程不会读回明文。伙伴包不能声明或覆盖这些字段。设置页测试连接只发送无敏感文本 `ping`，不发送屏幕帧。

## 5. 判定契约

发送给模型的任务仅限“当前屏幕是否与用户声明的学习目标相关”。输入包括学习目标、前台应用名、可选窗口标题、本场私人通讯策略和一张单帧；应用名本身不能决定结果。

模型必须返回：

```json
{
  "label": "focused",
  "confidence": 0.92,
  "reasonCode": "task_related_content"
}
```

`label` 只允许：

- `focused`
- `uncertain`
- `distracted`

`reasonCode` 只允许：

- `allowed_app`
- `blocked_app`
- `task_related_content`
- `entertainment_content`
- `private_communication`
- `insufficient_evidence`
- `capture_unavailable`
- `api_unavailable`
- `invalid_response`

其中 AI 只能提交 `task_related_content`、`entertainment_content`、`private_communication` 或 `insufficient_evidence`；本地规则与基础设施原因码由主进程生成。主进程还会按 `docs/10-inspection-decision-policy.md` 强制检查标签/原因码语义，不能仅依赖模型遵循提示词。

模型不得输出人物身份、聊天内容、账号、文件名或其他屏幕摘要。应用只接受纯 JSON 和上述三个精确字段；Markdown 包裹、额外字段和其他输出均视为无效响应。

## 6. 失败与阈值

- 连接失败、用户配置的请求超时、3xx、429、5xx、超过 64 KiB 的响应、空响应、非纯 JSON、额外字段、未知枚举或置信度越界：安全降级为 `uncertain`。
- AI 的 `focused` 置信度至少 0.70 才采用，否则为 `uncertain`。
- AI 的 `distracted` 必须在 15 秒后发起第二次独立单帧请求，并再次得到不低于 0.80 的同类结果，才确认偏航；每个请求始终只含一帧，不发送双帧批次或连续画面。
- 私人通讯默认归一化为 `uncertain`，不启动二次确认；只有用户为本场选择严格模式时才允许按 `distracted` 进入同样的两帧确认。
- 两次结果矛盾、第二次失败、前台应用在期间切换、用户停止共享或会话被暂停/销毁：`uncertain`；已经飞行的迟到网络结果作废。
- 同一次判定不自动重试网络请求，避免重复上传画面。

## 7. 用户可见控制

- 会话开始页默认不调用系统捕获能力；只有用户点击“加载可用屏幕”后才枚举脱敏屏幕摘要，再由用户明确选择捕获源。
- 会话开始页明确显示当前捕获源、AI 开关、窗口标题发送状态和私人通讯处理方式；API 地址与模型在设置页显示。
- 托盘和主界面均提供“停止屏幕巡查”，立即终止媒体流。
- 屏幕共享或 AI 降级时显示持续可见的状态标识，不伪装为完整巡查。
- 历史页只展示结构化观察，不提供“查看当时截图”入口。
- 设置页提供删除 API 密钥；历史清理与伙伴卸载尚未进入当前阶段。

## 8. 日志与诊断

允许记录：

- 时间、会话 ID、阶段、标签、置信度、原因码、耗时和错误码。
- 经过白名单处理的应用名。
- 捕获状态变化与伙伴媒体资源 ID。

禁止记录：

- JPEG/base64、完整窗口标题、学习目标正文、API 密钥、Authorization 头。
- 模型原始回答、字幕之外的屏幕 OCR、聊天或文件内容。

## 9. 未来摄像头

摄像头不属于 MVP。引入时必须使用单独授权、独立能力标识和独立隐私文档；不得因为屏幕巡查已授权而自动获得摄像头权限。
