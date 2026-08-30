import { describe, expect, it } from "vitest";
import { analyzeContentProtectionBitmap } from "./content-protection-analysis.js";

function paintBgra(
  bitmap: Uint8Array,
  width: number,
  startPixel: number,
  pixelCount: number,
  red: number,
  green: number,
  blue: number,
): void {
  for (let index = startPixel; index < startPixel + pixelCount; index += 1) {
    const offset = index * 4;
    bitmap[offset] = blue;
    bitmap[offset + 1] = green;
    bitmap[offset + 2] = red;
    bitmap[offset + 3] = 255;
  }
  expect(bitmap.byteLength).toBe(width * (bitmap.byteLength / 4 / width) * 4);
}

describe("content protection acceptance analysis", () => {
  const width = 100;
  const height = 100;

  it("控制标记可见且受保护标记缺失时通过", () => {
    const bitmap = new Uint8Array(width * height * 4);
    paintBgra(bitmap, width, 0, 500, 0, 255, 255);
    paintBgra(bitmap, width, 500, 500, 255, 255, 0);

    const result = analyzeContentProtectionBitmap(bitmap, width, height);
    expect(result.controlDetected).toBe(true);
    expect(result.protectedDetected).toBe(false);
    expect(result.outcome).toBe("passed");
  });

  it("成对受保护标记进入捕获帧时失败", () => {
    const bitmap = new Uint8Array(width * height * 4);
    paintBgra(bitmap, width, 0, 500, 0, 255, 255);
    paintBgra(bitmap, width, 500, 500, 255, 255, 0);
    paintBgra(bitmap, width, 1_000, 500, 255, 0, 255);
    paintBgra(bitmap, width, 1_500, 500, 0, 255, 0);

    expect(analyzeContentProtectionBitmap(bitmap, width, height).outcome).toBe("failed");
  });

  it("桌面中偶发的单一相近颜色不会误报受保护窗口泄漏", () => {
    const bitmap = new Uint8Array(width * height * 4);
    paintBgra(bitmap, width, 0, 500, 0, 255, 255);
    paintBgra(bitmap, width, 500, 500, 255, 255, 0);
    paintBgra(bitmap, width, 1_000, 500, 255, 0, 255);

    expect(analyzeContentProtectionBitmap(bitmap, width, height).outcome).toBe("passed");
  });

  it("控制标记不可见时不能误报通过", () => {
    const bitmap = new Uint8Array(width * height * 4);
    expect(analyzeContentProtectionBitmap(bitmap, width, height).outcome).toBe("inconclusive");
  });

  it("拒绝尺寸与字节数不匹配的输入", () => {
    expect(() => analyzeContentProtectionBitmap(new Uint8Array(16), 3, 3))
      .toThrow("ACCEPTANCE_BITMAP_LENGTH_INVALID");
  });
});
