// A tiny in-process fixed-window counter, keyed by a string (here: the hash of a
// driver link). The global Throttler is per IP; a driver link is a bearer
// credential, so it also needs its own ceiling no matter how many IPs use it.
// In-memory and per process, like the Throttler itself (a single VPS runs one
// process per app today; a shared store would be needed to scale out).
export class FixedWindowLimiter {
  private readonly windows = new Map<
    string,
    { count: number; resetAt: number }
  >();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = Date.now,
  ) {}

  // true = allowed
  hit(key: string): boolean {
    const t = this.now();
    if (this.windows.size > 5000) this.prune(t);
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      this.windows.set(key, { count: 1, resetAt: t + this.windowMs });
      return true;
    }
    w.count += 1;
    return w.count <= this.limit;
  }

  // Read-only view of a key's window: how many hits it holds and how long until
  // it resets. For a limiter that counts only FAILURES, so it must be asked
  // before the attempt without the ask itself counting.
  peek(key: string): { count: number; retryAfterMs: number } {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) return { count: 0, retryAfterMs: 0 };
    return { count: w.count, retryAfterMs: w.resetAt - t };
  }

  private prune(t: number) {
    for (const [k, w] of this.windows)
      if (w.resetAt <= t) this.windows.delete(k);
  }
}
