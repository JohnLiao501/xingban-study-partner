# 会话与体验规则

## 1. 会话配置

开始前必须选择：

- 已启用的 `partnerId`、`packVersion` 和 `sceneId`。
- 1～120 字的学习目标。
- 10～180 分钟的计划时长，默认 25 分钟。
- 可选的允许/禁止应用规则。
- 可选的屏幕源；未选择时只使用前台应用规则。
- 私人通讯处理默认“温和提醒”；可逐场选择严格模式，开工后锁定。
- 是否允许将未知状态的低分辨率单帧发送到配置的兼容 API，默认关闭。

## 2. 状态机

固定会话阶段为：

```text
preparing -> focusing -> patrolling -> feedback -> focusing
                         |                         |
                         +-------> break <---------+
focusing/patrolling/feedback/break -> completed | aborted | interrupted
```

- `preparing`：校验伙伴包、捕获状态和会话配置。
- `focusing`：正常计时与前台应用采样。
- `patrolling`：发起一次巡查，必要时获取屏幕单帧。
- `feedback`：播放伙伴反应并更新结构化观察。
- `break`：计划时长完成后的可选休息；不巡查、不累计有效专注。
- `completed`：用户完成结算。
- `aborted`：用户主动放弃。
- `interrupted`：崩溃、关机或捕获故障导致未正常结束；下次启动可恢复或关闭，不直接结算评价。

## 3. 巡查计划

随机数由会话级种子产生，便于测试重放，但不向用户显示下一次时间。

- 首次巡查：开始后 4～7 分钟。
- 正常间隔：3～8 分钟。
- 连续 15 分钟均为专注：下一间隔放宽为 6～10 分钟。
- 确认偏航后：下一间隔收紧为 2～4 分钟；连续 10 分钟专注后恢复正常。
- 开始后的前 2 分钟、暂停/休息期间和计划结束前 60 秒不发起巡查。

## 4. 判断与确认

### 4.1 本地规则

- 允许规则持续匹配：`focused`。
- 禁止规则持续匹配至少 20 秒：确认 `distracted`。
- 无规则或规则冲突：进入未知流程。

### 4.2 未知流程

- 未授权兼容 API、无捕获源或 API 失败：`uncertain`。
- AI 返回 `focused` 且置信度不低于 0.70：记录 `focused`。
- AI 返回 `distracted`：15 秒后再次抽样；两次置信度均不低于 0.80 才确认偏航。
- 私人通讯默认强制归一化为 `uncertain`；严格模式下仍必须通过上述两帧确认。
- 标签与原因码矛盾、AI 返回本地规则原因码或把应用名称直接当结论：`uncertain / invalid_response`。
- 其他情况均为 `uncertain`。

完整分类矩阵、目标上下文和不可观察边界见 `docs/10-inspection-decision-policy.md`。

## 5. 三次偏航

每场初始偏航额度为 3。一次确认偏航消耗 1 次，`uncertain` 永不消耗。

- 第 1 次：认真提醒，播放 `distracted_warning`。
- 第 2 次：加强提醒，但不增加巡查之外的持续监控。
- 第 3 次及以后：额度保持为 0，会话继续，本场评价最高为 C。
- 偏航后连续 5 分钟专注时播放 `recovery`，但不恢复额度。

## 6. 评价与信赖

完成率为 `focusedSeconds / plannedSeconds`，最高按 1.0 计算。基础评价：

| 完成率 | 基础评价 |
| --- | --- |
| >= 1.00 | S |
| >= 0.80 | A |
| >= 0.60 | B |
| >= 0.40 | C |
| < 0.40 | D |

偏航上限修正：1 次最高 A，2 次最高 B，3 次及以上最高 C。主动放弃为 D；异常中断不产生评价。

信赖增量：

```text
effectiveMinutes = floor(focusedSeconds / 60)
completionBonus  = 完成率 >= 0.80 且正常完成时为 10，否则为 0
deviationPenalty = confirmedDeviations * 3
trustGain        = max(0, effectiveMinutes + completionBonus - deviationPenalty)
```

信赖按 `partnerId` 独立累计、只增不减。当前等级为伙伴包中 `minimumTrust <= totalTrust` 的最高等级。

## 7. 反应选择

应用从当前场景对应动作键的候选中按 `weight` 加权选择，并遵守：

- 只选择达到 `minimumTrust` 的候选。
- 同一视频和台词在其 `cooldownSeconds` 内不重复。
- 无可用高等级候选时回退到最低信赖候选。
- 视频无法播放时仍显示字幕并播放可用音频；音频失败时回退为纯字幕。
