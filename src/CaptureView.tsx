import { useEffect, useRef } from "react";

const MAX_EDGE_PX = 768;
const JPEG_QUALITY = 0.6;

export function CaptureView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const api = window.studyPartner;
    if (!api) return;

    // 1. 监听初始化屏幕流请求
    const unbindInit = api.onCaptureInitStream?.(async ({ sourceId }) => {
      // 先清理旧流
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: sourceId,
            },
          } as unknown as MediaTrackConstraints,
        });

        streamRef.current = stream;

        // 监听系统级流中断（如用户点击系统的停止共享按钮）
        const videoTrack = stream.getVideoTracks()[0];
        if (videoTrack) {
          videoTrack.onended = () => {
            void api.notifyCaptureStreamEnded?.();
          };
        }

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
      } catch {
        void api.notifyCaptureStreamEnded?.();
      }
    });

    // 2. 监听请求低分辨率单帧
    const unbindRequestFrame = api.onCaptureRequestFrame?.(async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
        void api.sendCaptureFrame?.(null);
        return;
      }

      try {
        const originalWidth = video.videoWidth;
        const originalHeight = video.videoHeight;

        // 等比例缩放到最长边不超过 768px
        let targetWidth = originalWidth;
        let targetHeight = originalHeight;
        if (originalWidth >= originalHeight) {
          if (originalWidth > MAX_EDGE_PX) {
            targetWidth = MAX_EDGE_PX;
            targetHeight = Math.round((originalHeight * MAX_EDGE_PX) / originalWidth);
          }
        } else {
          if (originalHeight > MAX_EDGE_PX) {
            targetHeight = MAX_EDGE_PX;
            targetWidth = Math.round((originalWidth * MAX_EDGE_PX) / originalHeight);
          }
        }

        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");

        if (!ctx) {
          void api.sendCaptureFrame?.(null);
          return;
        }

        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        // 导出为 JPEG 0.60 格式单帧
        const blob = await new Promise<Blob | null>((resolve) => {
          canvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
        });

        // 立即清空 canvas 画布内容与尺寸引用
        ctx.clearRect(0, 0, targetWidth, targetHeight);
        canvas.width = 0;
        canvas.height = 0;

        if (!blob) {
          void api.sendCaptureFrame?.(null);
          return;
        }

        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        void api.sendCaptureFrame?.(uint8Array);
      } catch {
        void api.sendCaptureFrame?.(null);
      }
    });

    // 3. 监听停止捕获流
    const unbindStop = api.onCaptureStopStream?.(() => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
      if (videoRef.current) {
        videoRef.current.srcObject = null;
      }
    });

    return () => {
      unbindInit?.();
      unbindRequestFrame?.();
      unbindStop?.();
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) {
          track.stop();
        }
        streamRef.current = null;
      }
    };
  }, []);

  return (
    <main className="capture-view" aria-hidden="true">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        style={{ display: "none" }}
      />
    </main>
  );
}
