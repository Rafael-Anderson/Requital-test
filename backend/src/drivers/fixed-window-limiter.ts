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
    // Hard ceiling on tracked keys, so a flood of distinct keys cannot grow the
    // map without bound. ponytail: at the ceiling the oldest windows are
    // evicted (their counters forgotten), so an attacker able to mint that many
    // distinct keys inside one window could reset a counter; the real fix for
    // that is a shared store, same as scaling out.
    private readonly maxKeys: number = 20_000,
  ) {}

  // true = allowed
  hit(key: string): boolean {
    const t = this.now();
    const w = this.windows.get(key);
    if (!w || w.resetAt <= t) {
      // delete first so a re-opened window moves to the back: Map order is then
      // window-start order and eviction below drops the oldest.
      this.windows.delete(key);
      if (this.windows.size >= this.maxKeys) this.makeRoom(t);
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

  // Undo one hit (a reservation that turned out not to count). Never goes below
  // zero and drops the key when it empties.
  unhit(key: string): void {
    const w = this.windows.get(key);
    if (!w || w.resetAt <= this.now()) return;
    w.count -= 1;
    if (w.count <= 0) this.windows.delete(key);
  }

  // Drops expired windows, then the oldest live ones down to 90% of the ceiling,
  // so the O(n) sweep runs once per ~10% of inserts, not on every hit.
  private makeRoom(t: number) {
    for (const [k, w] of this.windows)
      if (w.resetAt <= t) this.windows.delete(k);
    const target = Math.floor(this.maxKeys * 0.9);
    for (const k of this.windows.keys()) {
      if (this.windows.size <= target) break;
      this.windows.delete(k);
    }
  }
}
