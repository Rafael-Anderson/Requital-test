// Host -> shop subdomain resolution for proxy.ts, with the same cache shape as
// the redirect map (lib/redirect-map.ts): a short positive cache, a coalesced
// cold fetch, a bounded size and a stale-on-failure grace period.
//
// THE RULE THIS FILE EXISTS FOR: only a backend 404 means "unknown host". A 429
// (throttled), a 5xx, a timeout, a network error or an unreadable body means
// "could not find out", and a real shop must never be answered 404 because the
// backend was busy. Such an answer serves the last known good subdomain, else
// reports "unavailable" so the proxy can send a 503 with Retry-After.

export const HOST_TTL_MS = 30_000;
export const HOST_STALE_MAX_MS = 5 * 60_000;
const FETCH_TIMEOUT_MS = 1_500;
const MAX_HOSTS = 500;
const DEFAULT_RETRY_AFTER = "5";

export type HostResolution =
  | { kind: "ok"; subdomain: string }
  | { kind: "unknown" }
  | { kind: "unavailable"; retryAfter: string };

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface HostResolverDeps {
  apiUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
  // Extra request headers (the signed internal-auth header), computed per call.
  headersFor?: (url: string, clientIp?: string) => Promise<Record<string, string>>;
}

// Copy the backend's value only when it is a plain small integer of seconds.
function retryAfterOf(res: Response | null): string {
  const v = res?.headers.get("retry-after")?.trim();
  return v && /^\d{1,4}$/.test(v) && Number(v) > 0 ? v : DEFAULT_RETRY_AFTER;
}

export function createHostResolver(deps: HostResolverDeps) {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const cache = new Map<string, { subdomain: string; at: number }>();
  const inflight = new Map<string, Promise<HostResolution>>();

  function remember(host: string, subdomain: string) {
    cache.delete(host);
    if (cache.size >= MAX_HOSTS) {
      for (const oldest of cache.keys()) {
        cache.delete(oldest);
        break;
      }
    }
    cache.set(host, { subdomain, at: now() });
  }

  function unavailable(host: string, res: Response | null): HostResolution {
    const stale = cache.get(host);
    if (stale && now() - stale.at < HOST_STALE_MAX_MS) {
      console.warn(`[proxy] /domains/resolve unavailable for "${host}": serving last-known-good subdomain "${stale.subdomain}"`);
      return { kind: "ok", subdomain: stale.subdomain };
    }
    console.warn(`[proxy] /domains/resolve unavailable for "${host}" (${res?.status ?? "no response"}) and no usable last-known-good: 503`);
    return { kind: "unavailable", retryAfter: retryAfterOf(res) };
  }

  async function fetchOnce(host: string, clientIp?: string): Promise<HostResolution> {
    const url = `${deps.apiUrl}/domains/resolve?host=${encodeURIComponent(host)}`;
    let res: Response | null = null;
    try {
      const headers = deps.headersFor ? await deps.headersFor(url, clientIp) : {};
      res = await fetchImpl(url, { headers, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      if (res.ok) {
        const data = (await res.json()) as { subdomain?: unknown };
        if (typeof data.subdomain === "string" && data.subdomain) {
          remember(host, data.subdomain);
          return { kind: "ok", subdomain: data.subdomain };
        }
        return unavailable(host, null);
      }
      if (res.status === 404) {
        // Genuinely unknown (or disconnected): never served from a stale entry.
        cache.delete(host);
        return { kind: "unknown" };
      }
    } catch {
      res = null;
    }
    return unavailable(host, res);
  }

  async function resolve(host: string, clientIp?: string): Promise<HostResolution> {
    const hit = cache.get(host);
    if (hit && now() - hit.at < HOST_TTL_MS) return { kind: "ok", subdomain: hit.subdomain };
    let pending = inflight.get(host);
    if (!pending) {
      pending = fetchOnce(host, clientIp).finally(() => inflight.delete(host));
      inflight.set(host, pending);
    }
    return pending;
  }

  return { resolve };
}
