import { useEffect, useState } from "react";
import type { OverlayPreviewPayload } from "../shared/partner-pack";
import { resolveAssetUrl } from "./lib/partner";

export function OverlayView() {
  const [preview, setPreview] = useState<OverlayPreviewPayload>();

  useEffect(() => {
    return window.studyPartner?.onOverlayPreview(setPreview);
  }, []);

  if (!preview) {
    return <main className="overlay-view overlay-view--waiting"><p>等待动作预览</p></main>;
  }

  return (
    <main className="overlay-view">
      <video
        autoPlay
        key={preview.videoPath}
        loop={preview.loop}
        muted
        playsInline
        src={resolveAssetUrl(preview.videoPath)}
      />
      <div className="overlay-view__shade" />
      <div className="overlay-view__label">{preview.label}</div>
      <p>{preview.line}</p>
    </main>
  );
}
