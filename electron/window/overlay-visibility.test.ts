import { afterEach, describe, expect, it, vi } from "vitest";
import { OverlayVisibilityTimeout } from "./overlay-visibility.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("OverlayVisibilityTimeout", () => {
  it("auto-hides a preview and resets the deadline when a new result arrives", () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const visibility = new OverlayVisibilityTimeout(hide, 5_000);

    visibility.schedule();
    vi.advanceTimersByTime(4_000);
    visibility.schedule();
    vi.advanceTimersByTime(4_999);
    expect(hide).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(hide).toHaveBeenCalledOnce();
  });

  it("cancels the deadline when the preview is hidden explicitly", () => {
    vi.useFakeTimers();
    const hide = vi.fn();
    const visibility = new OverlayVisibilityTimeout(hide, 5_000);

    visibility.schedule();
    visibility.hideNow();
    vi.advanceTimersByTime(5_000);

    expect(hide).toHaveBeenCalledOnce();
  });
});
