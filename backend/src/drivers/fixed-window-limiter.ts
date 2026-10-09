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

  private prune(t: number) {
    for (const [k, w] of this.windows)
      if (w.resetAt <= t) this.windows.delete(k);
  }
}
