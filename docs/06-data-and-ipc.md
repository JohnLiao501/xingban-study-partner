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
| value_json | TEXT | 经 Schema 校验的 JSON。 |
| updated_at | TEXT | ISO 8601 UTC。 |

API 密钥不进入此表，只保存 `apiKeySecretId`；密钥内容由 `safeStorage` 管理。

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
| goal | TEXT | 1～120 字。 |
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
- 所有请求与响应均由共享 TypeScript Schema 校验。
- renderer 不传入任意文件路径；安装包由系统文件选择器返回受控句柄。
- 事件只从主进程广播，renderer 无法伪造会话状态或巡查结果。

## 4. 请求/响应频道

| 频道 | 输入 | 输出 |
| --- | --- | --- |
| `partner:list` | 无 | 已安装伙伴与场景摘要。 |
| `partner:validate` | 文件选择令牌 | 校验报告，不安装。 |
| `partner:install` | 文件选择令牌 | 已安装伙伴摘要。 |
| `partner:set-enabled` | partnerId、packVersion、enabled | 更新后状态。 |
| `partner:get-progress` | partnerId | 当前伙伴的独立信赖摘要。 |
| `session:get-active` | 无 | 当前会话快照或 null。 |
| `session:start` | `StartSessionInput` | 会话快照。 |
| `session:pause` | sessionId | 会话快照。 |
| `session:resume` | sessionId | 会话快照。 |
| `session:preview-patrol` | sessionId | 阶段 2 验收用：快进到允许巡查的最早时间并返回巡查快照。 |
| `session:trigger-patrol` | sessionId | 立即巡查；仍受前 2 分钟与末 60 秒保护。 |
| `session:record-observation` | sessionId、`ObservationLabel` | 记录模拟或真实判断后的反馈快照。 |
| `session:complete-feedback` | sessionId | 反馈结束并回到专注。 |
| `session:start-break` | sessionId | 计划完成后进入默认 5 分钟休息。 |
| `session:finish` | sessionId、mode | 结算结果。 |
| `capture:select-source` | 无 | 捕获源摘要或取消。 |
| `capture:stop` | 无 | 捕获状态。 |
| `history:list` | 游标、limit | 会话摘要页。 |
| `rules:list` | 无 | 本机允许/禁止规则列表。 |
| `rules:save` | `SaveAppRuleInput` | 新建或更新规则。 |
| `rules:delete` | ruleId | 删除一条本机规则。 |
| `settings:get` | 固定键数组 | 脱敏设置。 |
| `settings:update` | 可更新设置对象 | 脱敏设置。 |
| `vision:test` | 无敏感测试请求 | 连接状态与错误码。 |

`StartSessionInput`：

```ts
interface StartSessionInput {
  partnerId: string;
  packVersion: string;
  sceneId: string;
  goal: string;
  plannedMinutes: number;
  captureSourceId?: string;
  visionEnabled: boolean;
  allowRuleIds: string[];
  blockRuleIds: string[];
}
```

## 5. 广播事件

| 事件 | 载荷 |
| --- | --- |
| `session:phase-changed` | sessionId、from、to、timestamp。 |
| `session:tick` | sessionId、elapsed、remaining、偏航额度；最高 1 Hz。 |
| `session:observation-created` | 脱敏 `Observation`。 |
| `partner:reaction-requested` | partnerId、sceneId、reactionKey、variantId、lineId。 |
| `capture:status-changed` | inactive、active、stopped、failed。 |
| `partner:progress-changed` | partnerId、totalTrust、levelId。 |

## 6. 错误码

| 前缀 | 示例 | 处理 |
| --- | --- | --- |
| `PACK_` | `PACK_SCHEMA_INVALID`、`PACK_HASH_MISMATCH` | 阻止安装并展示定位信息。 |
| `SESSION_` | `SESSION_ALREADY_ACTIVE`、`SESSION_INVALID_TRANSITION` | 保持现状，不部分写入。 |
| `CAPTURE_` | `CAPTURE_CANCELLED`、`CAPTURE_ENDED` | 取消或降级到本地规则。 |
| `VISION_` | `VISION_TIMEOUT`、`VISION_INVALID_RESPONSE` | 当前结果为 uncertain。 |
| `DB_` | `DB_MIGRATION_FAILED`、`DB_WRITE_FAILED` | 停止会话变更并保留可恢复检查点。 |
| `MEDIA_` | `MEDIA_DECODE_FAILED` | 降级到字幕/音频。 |
