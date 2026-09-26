// A push-to-pull queue: callbacks push values, one consumer iterates them.
// Bridges WebSocket events and merged streams into async generators.

export class Channel<T> implements AsyncIterable<T> {
  private readonly buffer: T[] = [];
  private closed = false;
  private failure: { reason: unknown } | undefined;
  private wake: (() => void) | undefined;

  push(value: T): void {
    if (this.closed) return;
    this.buffer.push(value);
    this.notify();
  }

  /** Ends iteration once the buffered values are consumed. */
  end(): void {
    this.closed = true;
    this.notify();
  }

  /** Makes iteration throw `reason` once the buffered values are consumed. */
  fail(reason: unknown): void {
    if (this.closed) return;
    this.failure = { reason };
    this.end();
  }

  private notify(): void {
    const wake = this.wake;
    this.wake = undefined;
    wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    for (;;) {
      if (this.buffer.length > 0) {
        yield this.buffer.shift() as T;
        continue;
      }
      if (this.failure) throw this.failure.reason;
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }
}
