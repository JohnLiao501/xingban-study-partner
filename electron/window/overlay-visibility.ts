import { SESSION_FEEDBACK_AUTO_CONTINUE_MS } from "../../shared/session.js";

export class OverlayVisibilityTimeout {
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly hide: () => void,
    private readonly delayMs = SESSION_FEEDBACK_AUTO_CONTINUE_MS,
  ) {}

  schedule(): void {
    this.cancel();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.hide();
    }, this.delayMs);
    this.timer.unref();
  }

  hideNow(): void {
    this.cancel();
    this.hide();
  }

  cancel(): void {
    if (!this.timer) return;
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
