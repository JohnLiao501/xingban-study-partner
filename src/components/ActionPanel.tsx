import {
  REACTION_KEYS,
  REACTION_LABELS,
  type ReactionKey,
} from "../../shared/partner-pack";
import { Icon } from "./Icon";

interface ActionPanelProps {
  selected: ReactionKey;
  onSelect: (reactionKey: ReactionKey) => void;
}

export function ActionPanel({ selected, onSelect }: ActionPanelProps) {
  return (
    <aside className="action-panel" aria-label="动作预览">
      <div className="action-panel__header">
        <div>
          <h2>动作预览</h2>
          <p>Partner v1 · 10 类</p>
        </div>
        <Icon name="action" size={21} />
      </div>
      <div className="action-list">
        {REACTION_KEYS.map((reactionKey, index) => (
          <button
            aria-pressed={selected === reactionKey}
            className={selected === reactionKey ? "action-item action-item--active" : "action-item"}
            key={reactionKey}
            onClick={() => onSelect(reactionKey)}
            type="button"
          >
            <span className="action-item__number">{String(index + 1).padStart(2, "0")}</span>
            <span className="action-item__label">{REACTION_LABELS[reactionKey]}</span>
            <span className="action-item__state" aria-hidden="true" />
          </button>
        ))}
      </div>
    </aside>
  );
}
