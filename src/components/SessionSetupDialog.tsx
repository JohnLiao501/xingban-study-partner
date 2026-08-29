import { useState, type FormEvent } from "react";
import type { StartSessionInput } from "../../shared/session";

interface SessionSetupDialogProps {
  partnerId: string;
  packVersion: string;
  sceneId: string;
  partnerName: string;
  sceneName: string;
  onCancel: () => void;
  onStart: (input: StartSessionInput) => void;
}

export function SessionSetupDialog({
  partnerId,
  packVersion,
  sceneId,
  partnerName,
  sceneName,
  onCancel,
  onStart,
}: SessionSetupDialogProps) {
  const [goal, setGoal] = useState("");
  const [plannedMinutes, setPlannedMinutes] = useState(25);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onStart({ partnerId, packVersion, sceneId, goal, plannedMinutes });
  };

  return (
    <div className="dialog-backdrop" role="presentation">
      <form aria-labelledby="session-setup-title" aria-modal="true" className="session-dialog" onSubmit={submit} role="dialog">
        <div className="session-dialog__eyebrow">新的专注航程</div>
        <h2 id="session-setup-title">准备开始学习</h2>
        <p className="session-dialog__summary">{partnerName} · {sceneName}</p>

        <label className="session-field">
          <span>本次目标</span>
          <input
            autoFocus
            maxLength={120}
            minLength={1}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="例如：完成高数错题复盘"
            required
            value={goal}
          />
          <small>{goal.length}/120</small>
        </label>

        <label className="session-field">
          <span>计划时长</span>
          <div className="duration-input">
            <input
              aria-label="计划时长（分钟）"
              max={180}
              min={10}
              onChange={(event) => setPlannedMinutes(Number(event.target.value))}
              required
              step={5}
              type="number"
              value={plannedMinutes}
            />
            <span>分钟</span>
          </div>
          <small>10～180 分钟；默认 25 分钟</small>
        </label>

        <div className="session-dialog__note">
          本阶段使用随机巡查与手动模拟判断，不读取屏幕，也不会调用 AI。
        </div>
        <div className="session-dialog__actions">
          <button className="button button--secondary" onClick={onCancel} type="button">取消</button>
          <button className="button button--primary" type="submit">开始本场</button>
        </div>
      </form>
    </div>
  );
}
