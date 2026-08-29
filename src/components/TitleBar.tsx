import { Icon } from "./Icon";

export function TitleBar() {
  const isDesktop = Boolean(window.studyPartner);

  return (
    <header className="title-bar">
      <div className="brand-lockup">
        <span className="brand-mark"><Icon name="spark" size={25} /></span>
        <span>星伴</span>
      </div>
      <div className="title-bar__drag-region" />
      <div className="runtime-label">{isDesktop ? "本地桌面版" : "浏览器预览"}</div>
      {isDesktop ? (
        <div className="window-controls">
          <button aria-label="最小化" onClick={() => void window.studyPartner?.minimizeWindow()} type="button">
            <Icon name="minimize" size={17} />
          </button>
          <button aria-label="最大化或还原" onClick={() => void window.studyPartner?.toggleMaximizeWindow()} type="button">
            <Icon name="maximize" size={15} />
          </button>
          <button aria-label="关闭到托盘" className="window-control--close" onClick={() => void window.studyPartner?.closeWindow()} type="button">
            <Icon name="close" size={17} />
          </button>
        </div>
      ) : null}
    </header>
  );
}
