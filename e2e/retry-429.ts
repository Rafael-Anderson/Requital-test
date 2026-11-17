// The CI-started backend runs in dev mode, so its per-IP throttles are live
// (5/min on signup, login and verify-email, 100/min elsewhere), and every spec
// in a run seeds from the same IP. A 429 says nothing about what a spec tests,
// and the throttle guard rejects before the handler runs, so retrying the same
// request after the window reopens is safe for any method.
//
// Waits for Retry-After when the server sends a usable one, else a fixed
// fallback; each wait is capped, and the total wait is bounded so a hook can
// still finish inside its own timeout. Returns the last response either way
// (the caller decides what a non-OK status means).

export interface Retry429Options {
  /** Upper bound on the summed waits, in ms. */
  maxTotalWaitMs?: number;
  /** Upper bound on a single wait, in ms. */
  maxSingleWaitMs?: number;
  /** Wait used when Retry-After is missing or unusable, in ms. */
  fallbackWaitMs?: number;
  /** Margin added to every wait, in ms (Retry-After is whole seconds). */
  marginMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Wait in ms for one 429, from its Retry-After header (seconds). */
export function waitFor429(
  retryAfter: string | null,
  opts: Required<Omit<Retry429Options, 'sleep' | 'maxTotalWaitMs'>>,
): number {
  const seconds = Number(retryAfter);
  const base =
    retryAfter !== null && Number.isFinite(seconds) && seconds > 0
      ? seconds * 1000
      : opts.fallbackWaitMs;
  return Math.min(base, opts.maxSingleWaitMs) + opts.marginMs;
}

export async function retryOn429(
  doFetch: () => Promise<Response>,
  options: Retry429Options = {},
): Promise<Response> {
  const opts = {
    maxTotalWaitMs: options.maxTotalWaitMs ?? 70_000,
    maxSingleWaitMs: options.maxSingleWaitMs ?? 65_000,
    fallbackWaitMs: options.fallbackWaitMs ?? 15_000,
    marginMs: options.marginMs ?? 500,
  };
  const sleep = options.sleep ?? defaultSleep;
  let waited = 0;
  for (;;) {
    const res = await doFetch();
    if (res.status !== 429) return res;
    const remaining = opts.maxTotalWaitMs - waited;
    if (remaining <= 0) return res;
    const wait = Math.min(
      waitFor429(res.headers.get('retry-after'), opts),
      remaining,
    );
    // Drain the body so the connection can be reused.
    await res.text().catch(() => undefined);
    await sleep(wait);
    waited += wait;
  }
}
