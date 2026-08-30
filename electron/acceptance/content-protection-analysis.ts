export interface ContentProtectionColorEvidence {
  width: number;
  height: number;
  minimumMarkerPixels: number;
  controlCyanPixels: number;
  controlYellowPixels: number;
  protectedMagentaPixels: number;
  protectedGreenPixels: number;
  controlDetected: boolean;
  protectedDetected: boolean;
  outcome: "passed" | "failed" | "inconclusive";
}

/**
 * Electron 在 Windows 的 NativeImage bitmap 使用 BGRA。验收标记选择了在 R/B
 * 互换下仍可区分的颜色组合，避免格式细节影响结论。
 */
export function analyzeContentProtectionBitmap(
  bitmap: Uint8Array,
  width: number,
  height: number,
): ContentProtectionColorEvidence {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
    throw new Error("ACCEPTANCE_BITMAP_DIMENSIONS_INVALID");
  }
  if (bitmap.byteLength !== width * height * 4) {
    throw new Error("ACCEPTANCE_BITMAP_LENGTH_INVALID");
  }

  let controlCyanPixels = 0;
  let controlYellowPixels = 0;
  let protectedMagentaPixels = 0;
  let protectedGreenPixels = 0;

  for (let offset = 0; offset < bitmap.byteLength; offset += 4) {
    const blue = bitmap[offset] ?? 0;
    const green = bitmap[offset + 1] ?? 0;
    const red = bitmap[offset + 2] ?? 0;

    if (red < 105 && green > 170 && blue > 170) controlCyanPixels += 1;
    if (red > 170 && green > 170 && blue < 105) controlYellowPixels += 1;
    if (red > 170 && green < 105 && blue > 170) protectedMagentaPixels += 1;
    if (red < 105 && green > 170 && blue < 105) protectedGreenPixels += 1;
  }

  // 两块验收标记在 768 px 单帧中仍会各占数千像素。使用成对颜色和较高阈值，
  // 避免桌布、图标或伙伴媒体里偶发的一小块绿色/紫色造成假失败。
  const minimumMarkerPixels = Math.max(120, Math.floor(width * height * 0.0015));
  const controlDetected = controlCyanPixels >= minimumMarkerPixels &&
    controlYellowPixels >= minimumMarkerPixels;
  const protectedDetected = protectedMagentaPixels >= minimumMarkerPixels &&
    protectedGreenPixels >= minimumMarkerPixels;

  return {
    width,
    height,
    minimumMarkerPixels,
    controlCyanPixels,
    controlYellowPixels,
    protectedMagentaPixels,
    protectedGreenPixels,
    controlDetected,
    protectedDetected,
    outcome: !controlDetected
      ? "inconclusive"
      : protectedDetected
        ? "failed"
        : "passed",
  };
}
