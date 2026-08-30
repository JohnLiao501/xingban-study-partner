# 数据模型与 IPC

## 1. 公共类型

```ts
type ObservationLabel = "focused" | "uncertain" | "distracted";

type SessionPhase =
  | "preparing"
  | "focusing"
  | "patrolling"
  | "feedback"
  | "break"
  | "completed"
  | "aborted"
  | "interrupted";

type SessionGrade = "S" | "A" | "B" | "C" | "D";

type ReactionKey =
  | "idle_loop"
  | "session_start"
  | "patrol_enter"
  | "focus_confirmed"
  | "uncertain_nudge"
  | "distracted_warning"
  | "recovery"
  | "break_invite"
  | "session_complete"
  | "session_partial";
```

## 2. SQLite 表

### 2.1 `schema_migrations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| version | INTEGER PK | 单调递增迁移号。 |
| applied_at | TEXT | ISO 8601 UTC。 |

### 2.2 `app_settings`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| key | TEXT PK | 设置键。 |
| value_json | TEXT | 按设置键解释的字符串；普通设置为严格校验后的 JSON，密钥项为 `safeStorage` 密文的 base64 表示。 |
| updated_at | TEXT | ISO 8601 UTC。 |

API 密钥明文不进入此表。主进程先用 Electron `safeStorage` 加密，再把密文字节编码为 base64 保存到固定键 `vision_api_key_encrypted`；renderer 只能获得 `apiKeyConfigured` 布尔值。

### 2.3 `partner_packs`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| partner_id | TEXT | 伙伴 ID。 |
| pack_version | TEXT | 包版本。 |
| display_name | TEXT | 展示名。 |
| source_type | TEXT | `private-fan` 或 `original`。 |
| distribution | TEXT | 分发限制。 |
| install_path | TEXT | 应用数据目录内的规范化路径。 |
| manifest_hash | TEXT | manifest SHA-256。 |
| enabled | INTEGER | 0/1。 |
| installed_at | TEXT | ISO 8601 UTC。 |

主键为 `(partner_id, pack_version)`。

### 2.4 `partner_progress`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| partner_id | TEXT PK | 与版本无关的稳定伙伴 ID。 |
| total_trust | INTEGER | 非负、只增不减。 |
| current_level_id | TEXT | 当前等级 ID。 |
| last_session_at | TEXT NULL | 最近正常会话。 |
| updated_at | TEXT | ISO 8601 UTC。 |

### 2.5 `sessions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID。 |
| partner_id | TEXT | 使用的伙伴。 |
| pack_version | TEXT | 使用的包版本。 |
| scene_id | TEXT | 使用的场景。 |
| goal | TEXT | 1～500 字。 |
| planned_seconds | INTEGER | 600～10800。 |
| phase | TEXT | `SessionPhase`。 |
| started_at | TEXT | ISO 8601 UTC。 |
| ended_at | TEXT NULL | 结束时间。 |
| focused_seconds | INTEGER | 已确认有效秒数。 |
| uncertain_seconds | INTEGER | 未确认秒数。 |
| distracted_seconds | INTEGER | 明确分心秒数。 |
| deviation_count | INTEGER | 非负整数。 |
| grade | TEXT NULL | S～D；中断时为空。 |
| trust_gained | INTEGER | 本场新增信赖。 |
| termination_reason | TEXT NULL | 完成、放弃、中断原因码。 |
| checkpoint_at | TEXT | 最近检查点时间。 |
| checkpoint_json | TEXT | 状态机恢复所需的内部快照；只含结构化状态。 |
| progress_applied | INTEGER | 结算信赖是否已应用，用于防止重试重复累计。 |

### 2.6 `observations`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID。 |
| session_id | TEXT FK | 所属会话。 |
| observed_at | TEXT | ISO 8601 UTC。 |
| label | TEXT | `ObservationLabel`。 |
| confidence | REAL | 0～1。 |
| source | TEXT | `local-rule`、`vision-api` 或 `fallback`。 |
| reason_code | TEXT | 固定原因码。 |
| app_name | TEXT NULL | 白名单处理后的进程名。 |
| window_title_hash | TEXT NULL | SHA-256，不保存原文。 |
| confirmed_deviation | INTEGER | 0/1。 |

### 2.7 `app_rules`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| id | TEXT PK | UUID。 |
| match_type | TEXT | `process` 或 `window-title`。 |
| pattern | TEXT | 用户声明的精确值或通配表达式。 |
| decision | TEXT | `allow` 或 `block`。 |
| enabled | INTEGER | 0/1。 |
| created_at | TEXT | ISO 8601 UTC。 |

## 3. IPC 规则

- 频道名使用 `domain:action`，仅允许下表中的固定频道。
- 主进程把输入视为 `unknown`，运行严格白名单校验：拒绝额外/缺失字段、未知枚举、超长字符串、非法 URL、重复规则 ID 和越界数值。
- renderer 不传入任意安装路径；伙伴目录只由主进程系统选择器取得。
- preload 按窗口拆分，主进程再按 `event.sender === expectedWindow.webContents` 校验：主窗口、悬浮窗和截图窗不能互调能力。
- 会话时间、巡查结果、数据库与系统能力以主进程为准。浏览器预览的手工巡查只直接调用共享纯状态机，不进入 Electron IPC；桌面 preload 不暴露手工巡查触发或结果提交能力，自动巡查只通过主进程内部服务入口推进状态。

## 4. 请求/响应频道

### 4.1 主窗口可调用

| 频道 | 输入 | 输出 |
| --- | --- | --- |
| `app:get-bootstrap` | 无 | 当前伙伴清单、资源基址和桌面运行标志。 |
| `partner:list` | 无 | 已安装伙伴摘要。 |
| `partner:select` | partnerId | 新的启动数据。 |
| `partner:import-directory` | 无；主进程打开目录选择器 | 安装结果或取消。 |
| `partner:get-progress` | partnerId | 当前伙伴独立信赖。 |
| `overlay:show-preview` | 严格 `OverlayPreviewPayload` | 无。 |
| `overlay:hide` | 无 | 无。 |
| `session:get-active` | 无 | 当前会话快照或 null。 |
| `session:start` | `StartSessionInput` | 会话快照。 |
| `session:pause` / `session:resume` | sessionId | 会话快照。 |
| `session:complete-feedback` / `session:start-break` | sessionId | 会话快照。 |
| `session:finish` | sessionId、mode | 结算结果。 |
| `history:list` | limit 1～200 | 会话历史摘要。 |
| `history:list-observations` | sessionId | 脱敏结构化观察列表。 |
| `rules:list` / `rules:save` / `rules:delete` | 无 / 严格规则对象 / ruleId | 规则结果。 |
| `capture:list-sources` | 无；仅由用户点击“加载可用屏幕”触发 | 仅显示器类型的脱敏摘要。 |
| `capture:stop` | 无 | 无；学习会话继续。 |
| `settings:get-vision` | 无 | 不含密钥的 `VisionSettingsView`。 |
| `settings:save-vision` | 严格设置对象，可短暂含 apiKey/clearApiKey | 不含密钥的设置视图。 |
| `settings:test-connection` | 无 | ok 与低敏消息。 |
| `window:minimize` / `window:toggle-maximize` / `window:close` | 无 | 窗口操作结果。 |

### 4.2 截图工作窗专用

| 频道 | 输入 | 输出 |
| --- | --- | --- |
| `capture:stream-ready` | 无 | 无；主进程从 `starting` 进入 `active`。 |
| `capture:stream-ended` | 无 | 无；停止并降级。 |
| `capture:send-frame` | JPEG `Uint8Array` 或 null | 无；主进程再校验大小与 JPEG 起止标记。 |

`StartSessionInput`：

```ts
interface StartSessionInput {
  partnerId: string;
  packVersion: string;
  sceneId: string;
  goal: string;
  plannedMinutes: number;
  captureSourceId?: string;
  visionEnabled?: boolean;
  sendWindowTitle?: boolean;
  allowRuleIds?: string[];
  blockRuleIds?: string[];
}
```

## 5. 广播事件

| 事件 | 载荷 |
| --- | --- |
| `session:changed` | 完整主进程权威会话快照；最高约 1 Hz。 |
| `capture:status-changed` | `inactive`、`starting`、`active`、`stopped`、`failed`。 |
| `overlay:preview` | 仅发往悬浮窗的严格预览载荷。 |
| `capture:init-stream` | 仅发往截图窗；不含 source ID。 |
| `capture:request-frame` | 仅发往截图窗的一次单帧请求。 |
| `capture:stop-stream` | 仅发往截图窗的停止指令。 |

## 6. 错误码

| 前缀 | 示例 | 处理 |
| --- | --- | --- |
| `PACK_` | `PACK_SCHEMA_INVALID`、`PACK_HASH_MISMATCH` | 阻止安装并展示定位信息。 |
| `SESSION_` | `SESSION_ALREADY_ACTIVE`、`SESSION_NOT_FOUND`、`SESSION_INVALID_TRANSITION` | 保持现状，不部分写入。 |
| 捕获状态 | `failed`、`stopped`、`capture_unavailable` | 取消或降级到本地规则；当前实现主要使用状态与原因码而非向 UI 抛出捕获错误。 |
| `VISION_` | `VISION_REQUEST_TIMEOUT`、`VISION_HTTP_ERROR_429`、`VISION_RESPONSE_TOO_LARGE` | 编排层把当前结果安全降级为 uncertain。 |
| `IPC_` | `IPC_INVALID_PAYLOAD`、`IPC_UNAUTHORIZED_SENDER` | 拒绝请求且不扩大窗口能力。 |
| `DB_` | `DB_MIGRATION_FAILED`、`DB_WRITE_FAILED` | 停止会话变更并保留可恢复检查点。 |
| `MEDIA_` | `MEDIA_DECODE_FAILED` | 降级到字幕/音频。 |
