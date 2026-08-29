import { useEffect, useRef, useState } from "react";
import { REACTION_LABELS } from "../../shared/partner-pack";
import type { ReactionPreview } from "../lib/partner";
import { formatMediaTime, resolveAssetUrl } from "../lib/partner";
import { Icon } from "./Icon";

interface MediaStageProps {
  coverPath: string;
  partnerName: string;
  preview: ReactionPreview;
  activityLabel?: string;
  onShowOverlay: () => void;
}

export function MediaStage({ activityLabel, coverPath, partnerName, preview, onShowOverlay }: MediaStageProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [isPlaying, setIsPlaying] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(preview.video.durationMs ? preview.video.durationMs / 1000 : 0);
  const [mediaFailed, setMediaFailed] = useState(false);

  const videoUrl = resolveAssetUrl(preview.video.filePath);
  const coverUrl = resolveAssetUrl(coverPath);

  useEffect(() => {
    setMediaFailed(false);
    setCurrentTime(0);
    setDuration(preview.video.durationMs ? preview.video.durationMs / 1000 : 0);
    setIsPlaying(true);
  }, [preview.variantId, preview.video.durationMs]);

  const togglePlayback = async () => {
    const video = videoRef.current;
    if (!video || mediaFailed) return;
    if (video.paused) await video.play();
    else video.pause();
  };

  const seek = (nextTime: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const toggleMute = () => {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
    setIsMuted(video.muted);
  };

  const requestFullscreen = async () => {
    const stage = videoRef.current?.closest(".media-stage");
    if (stage instanceof HTMLElement) await stage.requestFullscreen();
  };

  return (
    <section className="media-column">
      <div className="media-stage">
        <img alt="静谧观测室原创场景封面" className="media-fallback" src={coverUrl} />
        {!mediaFailed ? (
          <video
            autoPlay
            className="media-video"
            key={videoUrl}
            loop={Boolean(preview.video.loop)}
            muted={isMuted}
            onDurationChange={(event) => setDuration(event.currentTarget.duration)}
            onEnded={() => setIsPlaying(false)}
            onError={() => {
              setMediaFailed(true);
              setIsPlaying(false);
            }}
            onPause={() => setIsPlaying(false)}
            onPlay={() => setIsPlaying(true)}
            onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
            playsInline
            poster={coverUrl}
            ref={videoRef}
            src={videoUrl}
          />
        ) : null}
        <div className="media-vignette" aria-hidden="true" />
        <div className="media-identity">
          <h1>{partnerName}</h1>
          <p><span aria-hidden="true" />{mediaFailed ? "字幕降级中" : activityLabel ?? "待机中"}</p>
        </div>
        <p className="subtitle" aria-live="polite">{preview.line.text}</p>
        {mediaFailed ? (
          <div className="fallback-notice" role="status">视频不可用，已安全降级为封面与字幕</div>
        ) : null}
      </div>

      <div className="media-controls">
        <button
          aria-label={isPlaying ? "暂停" : "播放"}
          className="control-button control-button--primary"
          disabled={mediaFailed}
          onClick={() => void togglePlayback()}
          type="button"
        >
          <Icon name={isPlaying ? "pause" : "play"} size={22} />
        </button>
        <button aria-label={isMuted ? "取消静音" : "静音"} className="control-button" onClick={toggleMute} type="button">
          <Icon name={isMuted ? "mute" : "volume"} size={20} />
        </button>
        <input
          aria-label="播放进度"
          className="progress-slider"
          max={Math.max(duration, 0.01)}
          min="0"
          onChange={(event) => seek(Number(event.target.value))}
          step="0.01"
          type="range"
          value={Math.min(currentTime, Math.max(duration, 0.01))}
        />
        <time>{formatMediaTime(currentTime)} / {formatMediaTime(duration)}</time>
        <button aria-label="在巡查窗预览" className="control-button" onClick={onShowOverlay} type="button">
          <Icon name="overlay" size={19} />
        </button>
        <button aria-label="全屏" className="control-button" onClick={() => void requestFullscreen()} type="button">
          <Icon name="fullscreen" size={18} />
        </button>
      </div>

      <div className="playback-caption">
        <span className="playback-caption__icon"><Icon name="play" size={13} /></span>
        <span>正在预览：</span>
        <strong>{REACTION_LABELS[preview.reactionKey]}</strong>
        <code>{preview.reactionKey}</code>
      </div>
    </section>
  );
}
