// The engine's transcript: lines not yet shown to the model, bounded in size,
// and a window of recently shown ones it is reminded of.
import type { LoggerLike } from "@repo/logger";
import type { Segment } from "@repo/transcriber";

import type { EngineOptions } from "./engine-options";

type TranscriptBufferOptions = Pick<
  EngineOptions,
  "maxBufferChars" | "maxBufferSegments" | "contextSeconds" | "maxContextChars"
>;

class TranscriptBuffer {
  private readonly logger: LoggerLike;
  private readonly options: TranscriptBufferOptions;
  private readonly pending: Segment[] = [];
  private chars = 0;
  private readonly context: Segment[] = [];
  private lastAudioTime: number | undefined;

  constructor(logger: LoggerLike, options: TranscriptBufferOptions) {
    this.logger = logger;
    this.options = options;
  }

  /** Audio time (seconds) at the end of the latest line, if any. */
  get audioTime(): number | undefined {
    return this.lastAudioTime;
  }

  /** How many lines are waiting. */
  get size(): number {
    return this.pending.length;
  }

  /** How many characters are waiting. */
  get pendingChars(): number {
    return this.chars;
  }

  add(segment: Segment): void {
    this.pending.push(segment);
    this.chars += segment.text.length;
    this.lastAudioTime = segment.end;
    this.trim();
  }

  /** Empties the pending lines and returns them. */
  take(): Segment[] {
    const segments = this.pending.splice(0);
    this.chars = 0;
    return segments;
  }

  /** Moves sent lines into the context window. */
  remember(segments: Segment[]): void {
    this.context.push(...segments);
    this.forget();
  }

  /** The context window, oldest first, after dropping what has aged out. */
  recent(): Segment[] {
    this.forget();
    return [...this.context];
  }

  /** Puts unsent lines back at the front of the buffer. */
  restore(segments: Segment[]): void {
    this.pending.unshift(...segments);
    this.chars = this.pending.reduce(
      (sum, segment) => sum + segment.text.length,
      0
    );
    this.trim();
  }

  private trim(): void {
    const max = this.options.maxBufferChars ?? 4000;
    const maxSegments = this.options.maxBufferSegments ?? 100;
    let dropped = 0;
    while (
      (this.chars > max || this.pending.length > maxSegments) &&
      this.pending.length > 1
    ) {
      const oldest = this.pending.shift();
      if (!oldest) {
        break;
      }
      this.chars -= oldest.text.length;
      dropped += 1;
    }
    if (dropped > 0) {
      this.logger.warn("transcript buffer full, dropped oldest lines", {
        dropped,
        maxChars: max,
        maxSegments,
      });
    }
  }

  /** Drops context older than the window, measured from the latest audio. */
  private forget(): void {
    const horizon =
      (this.lastAudioTime ?? 0) - (this.options.contextSeconds ?? 300);
    const maxChars = this.options.maxContextChars ?? 6000;
    let chars = this.context.reduce((sum, item) => sum + item.text.length, 0);
    while (this.context.length > 0) {
      const oldest = this.context[0];
      if (!oldest || (oldest.end > horizon && chars <= maxChars)) {
        break;
      }
      this.context.shift();
      chars -= oldest.text.length;
    }
  }
}

export { TranscriptBuffer };
