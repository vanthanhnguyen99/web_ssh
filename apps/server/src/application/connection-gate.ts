import { DomainError } from "../domain/errors.js";
/** Limits active protocol handshakes, including prompts, while IDs remain attachable. */
export class ConnectionGate {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  constructor(private readonly limit = 4) {}
  async run<T>(signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve, reject) => {
      let acquired = false;
      const cancelled = () => {
        if (acquired) return;
        const index = this.queue.indexOf(start);
        if (index >= 0) this.queue.splice(index, 1);
        reject(new DomainError("SESSION_EXPIRED", "Connection was cancelled"));
      };
      const start = () => {
        if (signal.aborted) {
          cancelled();
          return;
        }
        acquired = true;
        signal.removeEventListener("abort", cancelled);
        this.active++;
        resolve();
      };
      if (signal.aborted) {
        cancelled();
        return;
      }
      signal.addEventListener("abort", cancelled, { once: true });
      if (this.active < this.limit) start();
      else this.queue.push(start);
    });
    try {
      if (signal.aborted)
        throw new DomainError("SESSION_EXPIRED", "Connection was cancelled");
      return await action();
    } finally {
      this.active--;
      this.queue.shift()?.();
    }
  }
}
