import { useEffect, useRef } from "react";

const MAX_EDGE_PX = 768;
const JPEG_QUALITY = 0.6;

export function CaptureView() {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  useEffect(() => {
    const api = window.studyPartner;
    if (!api) return;
    let streamGeneration = 0;

    const stopCurrentStream = () => {
      if (streamRef.current) {
        for (const track of streamRef.current.getTracks()) track.stop();
        streamRef.current = null;
      }
      if (videoRef.current) videoRef.current.srcObject = null;
    };

    // 1. 监听初始化屏幕流请求
    const unbindInit = api.onCaptureInitStream?.(async () => {
      console.info("[CaptureView] INIT_RECEIVED");
      const currentGeneration = ++streamGeneration;
      stopCurrentStream();

      try {
        const stream = await navigator.mediaDevices.getDisplayMedia({
          audio: false,
          video: true,
        });

        // 用户可能在系统选择器或异步授权期间已经停止、重选或结束会话。
        if (currentGeneration !== streamGeneration) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }

        // 监听系统级流中断（如用户点击系统的停止共享按钮）
        const videoTrack = stream.getVideoTracks()[0];
        if (!videoTrack) {
          for (const track of stream.getTracks()) track.stop();
          throw new Error("CAPTURE_VIDEO_TRACK_MISSING");
        }
        streamRef.current = stream;
        videoTrack.onended = () => {
          if (currentGeneration === streamGeneration) {
            void api.notifyCaptureStreamEnded?.();
          }
        };

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }
        if (currentGeneration !== streamGeneration) {
          for (const track of stream.getTracks()) track.stop();
          return;
        }
        console.info("[CaptureView] STREAM_READY");
        await api.notifyCaptureStreamReady?.();
      } catch (error) {
        // 只记录低敏异常类别，禁止输出源 ID、窗口标题、画面或浏览器原始错误详情。
        const errorCode = error instanceof DOMException
          ? error.name
          : "CAPTURE_STREAM_START_FAILED";
        console.error(`[CaptureView] ${errorCode}`);
        if (currentGeneration === streamGeneration) {
          void api.notifyCaptureStreamEnded?.();
        }
      }
    });

    // 2. 监听请求低分辨率单帧
    const unbindRequestFrame = api.onCaptureRequestFrame?.(async () => {
      const video = videoRef.current;
      if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
        await api.sendCaptureFrame?.(null);
        return;
      }

      let canvas: HTMLCanvasElement | null = null;
      let context: CanvasRenderingContext2D | null = null;
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

        canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        context = canvas.getContext("2d");

        if (!context) {
          await api.sendCaptureFrame?.(null);
          return;
        }

        context.drawImage(video, 0, 0, targetWidth, targetHeight);

        // 导出为 JPEG 0.60 格式单帧
        const activeCanvas = canvas;
        const blob = await new Promise<Blob | null>((resolve) => {
          activeCanvas.toBlob((b) => resolve(b), "image/jpeg", JPEG_QUALITY);
        });

        // 立即清空 canvas 画布内容与尺寸引用
        if (!blob) {
          await api.sendCaptureFrame?.(null);
          return;
        }

        const arrayBuffer = await blob.arrayBuffer();
        const uint8Array = new Uint8Array(arrayBuffer);
        try {
          await api.sendCaptureFrame?.(uint8Array);
        } finally {
          uint8Array.fill(0);
        }
      } catch {
        await api.sendCaptureFrame?.(null);
      } finally {
        if (canvas) {
          context?.clearRect(0, 0, canvas.width, canvas.height);
          canvas.width = 0;
          canvas.height = 0;
        }
      }
    });

    // 3. 监听停止捕获流
    const unbindStop = api.onCaptureStopStream?.(() => {
      console.info("[CaptureView] STOP_RECEIVED");
      streamGeneration += 1;
      stopCurrentStream();
    });

    // 监听器全部绑定后再通知主进程。零延迟定时器也避开 React StrictMode
    // 开发态的首次 setup/cleanup 探测，防止主进程向已解绑的监听器发消息。
    const rendererReadyTimer = window.setTimeout(() => {
      console.info("[CaptureView] RENDERER_READY");
      void api.notifyCaptureRendererReady?.().catch(() => {
        console.error("[CaptureView] RENDERER_READY_IPC_FAILED");
      });
    }, 0);

    return () => {
      window.clearTimeout(rendererReadyTimer);
      unbindInit?.();
      unbindRequestFrame?.();
      unbindStop?.();
      streamGeneration += 1;
      stopCurrentStream();
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
