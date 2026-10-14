import { monitorEventLoopDelay } from "node:perf_hooks";
/** Process measurements have no protocol/session payload access. */
export class ProcessMonitor {
  private readonly lag = monitorEventLoopDelay({ resolution: 20 });
  constructor() {
    this.lag.enable();
  }
  snapshot() {
    const memory = process.memoryUsage();
    return {
      memory: { rss: memory.rss, heapUsed: memory.heapUsed },
      eventLoopLagMs: {
        mean: Number.isFinite(this.lag.mean) ? this.lag.mean / 1e6 : 0,
        p95: this.lag.percentile(95) / 1e6,
        max: this.lag.max / 1e6,
      },
    };
  }
  close() {
    this.lag.disable();
  }
}
