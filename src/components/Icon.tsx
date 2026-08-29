import type { SVGProps } from "react";

export type IconName =
  | "action"
  | "close"
  | "companion"
  | "fullscreen"
  | "history"
  | "home"
  | "import"
  | "maximize"
  | "minimize"
  | "mute"
  | "overlay"
  | "pause"
  | "play"
  | "settings"
  | "spark"
  | "volume";

const paths: Record<IconName, React.ReactNode> = {
  action: <><circle cx="12" cy="12" r="7" /><path d="m12 8 3.5 4-3.5 4M8.5 12h7" /></>,
  close: <path d="m7 7 10 10M17 7 7 17" />,
  companion: <><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2.5" /><path d="M3.8 19c.6-3.5 2.3-5.2 5.2-5.2s4.6 1.7 5.2 5.2M15 14c3.1-.4 5 1.3 5.4 4" /></>,
  fullscreen: <path d="M8 3H3v5M16 3h5v5M8 21H3v-5M16 21h5v-5" />,
  history: <><circle cx="12" cy="12" r="8.5" /><path d="M12 7v5l3.5 2" /></>,
  home: <><path d="m3.5 11 8.5-7 8.5 7" /><path d="M5.5 10v10h13V10M9.5 20v-6h5v6" /></>,
  import: <><path d="M12 3v12M7.5 10.5 12 15l4.5-4.5" /><path d="M4 16.5V20h16v-3.5" /></>,
  maximize: <rect x="5" y="5" width="14" height="14" rx="1.5" />,
  minimize: <path d="M5 12h14" />,
  mute: <><path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="m17 10 4 4m0-4-4 4" /></>,
  overlay: <><rect x="3.5" y="5" width="17" height="13" rx="2" /><path d="M13 13h5v3" /></>,
  pause: <><path d="M9 7v10M15 7v10" /></>,
  play: <path d="m9 6 9 6-9 6V6z" />,
  settings: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" /></>,
  spark: <><path d="m12 2 2.2 7.8L22 12l-7.8 2.2L12 22l-2.2-7.8L2 12l7.8-2.2L12 2z" /><circle cx="12" cy="12" r="1.8" /></>,
  volume: <><path d="M4 10v4h4l5 4V6L8 10H4z" /><path d="M16 9c1.8 1.5 1.8 4.5 0 6M19 6.5c3.5 3 3.5 8 0 11" /></>,
};

interface IconProps extends SVGProps<SVGSVGElement> {
  name: IconName;
  size?: number;
}

export function Icon({ name, size = 20, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.7"
      {...props}
    >
      {paths[name]}
    </svg>
  );
}
