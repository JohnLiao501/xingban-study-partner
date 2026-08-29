import { Icon, type IconName } from "./Icon";

export type AppView = "study" | "history" | "settings";

const navigation: Array<{ id: AppView | "partner" | "settings"; label: string; icon: IconName; enabled: boolean }> = [
  { id: "study", label: "督学室", icon: "home", enabled: true },
  { id: "partner", label: "伙伴", icon: "companion", enabled: false },
  { id: "history", label: "历史", icon: "history", enabled: true },
  { id: "settings", label: "规则", icon: "settings", enabled: true },
];

interface SidebarProps {
  currentView: AppView;
  onNavigate: (view: AppView) => void;
}

export function Sidebar({ currentView, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar" aria-label="主导航">
      <nav>
        {navigation.map((item) => (
          <button
            aria-current={item.id === currentView ? "page" : undefined}
            className={item.id === currentView ? "nav-item nav-item--active" : "nav-item"}
            disabled={!item.enabled}
            key={item.label}
            onClick={() => {
              if (item.id === "study" || item.id === "history" || item.id === "settings") onNavigate(item.id);
            }}
            title={item.enabled ? item.label : `${item.label}将在后续阶段接入`}
            type="button"
          >
            <Icon name={item.icon} size={21} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>
      <div className="sidebar-orbit" aria-hidden="true">
        <span />
      </div>
      <p className="sidebar-version">v0.1.0 · Partner v1</p>
    </aside>
  );
}
