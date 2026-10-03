// URL redirect lookup for proxy.ts (ONB-4). Pure matching + a small per-shop
// cache; no Next imports so it unit-tests without a runtime.
//
// WHY A MAP AND NOT A CALL PER REQUEST. proxy.ts runs on every page request.
// A per-request backend lookup of "is this path redirected?" would double the
// hot-path round trips (it already makes one for host resolution). Instead the
// proxy holds each shop's whole resolved redirect map for 30s (the backend caps
// it at 10,000 rows, roughly 1 MB of JSON worst case, and answers 304 when it
// has not changed) and matches in-process: the steady-state cost of a request
// is one Map lookup. A shop with no redirects costs one tiny request per 30s.
//
// SAME CACHE SHAPE AS HOST RESOLUTION: 30s TTL, stale-on-backend-failure (a
// stale map keeps serving for up to 5 minutes), and the lookup can never block
// or break a page: a fetch has a hard timeout and every failure means "no
// redirect, serve the page".
//
// KEYED BY SHOP. Every cache entry is keyed by the resolved shop slug, so one
// shop's redirects can never be applied to another's request.
//
// SAFETY IS RE-CHECKED HERE. The backend only sends targets that passed its
// open-redirect rules, but this file does not trust that: safeLocation() accepts
// only a same-origin path or an absolute URL on one of the shop's own hosts
// (which the backend sends alongside the map), and drops everything else.

export interface RedirectHit {
  location: string;
  status: 301 | 302;
}

interface MapEntry {
  to: string;
  status: number;
}

interface CachedMap {
  byPath: Map<string, MapEntry>;
  hosts: string[];
  etag: string | null;
  fetchedAt: number;
  retryAfter: number;
  inflight: Promise<void> | null;
}

export const REDIRECT_MAP_TTL_MS = 30_000;
export const REDIRECT_MAP_STALE_MAX_MS = 5 * 60_000;
const RETRY_AFTER_FAILURE_MS = 5_000;
const FETCH_TIMEOUT_MS = 1_500;
const MAX_SHOPS = 500;
const MAX_ENTRIES = 10_000;
const MAX_PENDING_HITS_PER_SHOP = 1_000;
const HITS_PER_FLUSH = 100;

// MIRROR of backend/src/url-redirects/redirect-rules.ts's canonicalizeRequestPath
// (the two apps share no code). Decode each segment, lowercase, re-encode; null
// for anything that cannot safely be matched. Change both together.
export function canonicalizePath(pathname: string): string | null {
  if (typeof pathname !== "string" || pathname.length > 4000 || !pathname.startsWith("/")) return null;
  const segments = pathname.split(/[?#]/, 1)[0].split("/").slice(1);
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const raw = segments[i];
    if (raw === "") {
      if (i === segments.length - 1 || segments.length === 1) continue;
      return null;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // eslint-disable-next-line no-control-regex
    if (/[\x00-\x1f\x7f\\/]/.test(decoded)) return null;
    if (decoded === "." || decoded === "..") return null;
    out.push(encodeURIComponent(decoded.normalize("NFC").toLowerCase()));
  }
  const canonical = `/${out.join("/")}`;
  return canonical.length > 512 ? null : canonical;
}

function normalizeHost(host: string): string | null {
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
}

// The Location to send, or null when the target is not safe. `search` is the
// visitor's own query string (with its leading "?"): it is carried over to a
// target that has no query of its own, so campaign parameters survive.
export function safeLocation(to: string, search: string, hosts: readonly string[]): string | null {
  // eslint-disable-next-line no-control-regex
  if (typeof to !== "string" || !to || /[\x00-\x20\x7f\\]/.test(to)) return null;
  if (to.startsWith("/")) {
    if (to.startsWith("//")) return null;
    let candidate = to;
    if (search && !to.includes("?")) {
      const hash = to.indexOf("#");
      candidate = hash === -1 ? `${to}${search}` : `${to.slice(0, hash)}${search}${to.slice(hash)}`;
    }
    try {
      const parsed = new URL(candidate, "https://shop.invalid");
      if (parsed.origin !== "https://shop.invalid") return null;
      // Re-serialised so a non-ASCII character is percent-encoded: a raw one
      // would make the Location header invalid and throw when the response is built.
      return `${parsed.pathname}${parsed.search}${parsed.hash}`;
    } catch {
      return null;
    }
  }
  let url: URL;
  try {
    url = new URL(to);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username || url.password || url.port) return null;
  const own = hosts.map(normalizeHost).filter((h): h is string => h !== null);
  if (!own.includes(url.hostname)) return null;
  if (search && !url.search) url.search = search;
  return url.href;
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export interface RedirectStoreDeps {
  apiUrl: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}

export function createRedirectStore(deps: RedirectStoreDeps) {
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((input, init) => fetch(input, init));
  const now = deps.now ?? Date.now;
  const cache = new Map<string, CachedMap>();
  const pendingHits = new Map<string, Map<string, number>>();
  const coldInflight = new Map<string, Promise<void>>();

  function evictIfFull() {
    if (cache.size < MAX_SHOPS) return;
    for (const oldest of cache.keys()) {
      cache.delete(oldest);
      break;
    }
  }

  function takeHits(shop: string): { path: string; count: number }[] {
    const pending = pendingHits.get(shop);
    if (!pending || pending.size === 0) return [];
    const batch: { path: string; count: number }[] = [];
    for (const [path, count] of pending) {
      batch.push({ path, count: Math.min(count, 1000) });
      pending.delete(path);
      if (batch.length >= HITS_PER_FLUSH) break;
    }
    return batch;
  }

  // Fire-and-forget: hit counts are advisory and must never affect a page.
  function flushHits(shop: string) {
    const hits = takeHits(shop);
    if (hits.length === 0) return;
    const url = `${deps.apiUrl}/public/${encodeURIComponent(shop)}/redirects/hits`;
    fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ hits }),
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    }).catch(() => {});
  }

  function recordHit(shop: string, path: string) {
    let pending = pendingHits.get(shop);
    if (!pending) {
      pending = new Map();
      pendingHits.set(shop, pending);
    }
    if (!pending.has(path) && pending.size >= MAX_PENDING_HITS_PER_SHOP) return;
    pending.set(path, (pending.get(path) ?? 0) + 1);
  }

  async function refresh(shop: string): Promise<void> {
    const existing = cache.get(shop);
    const t = now();
    const url = `${deps.apiUrl}/public/${encodeURIComponent(shop)}/redirects/map`;
    try {
      const res = await fetchImpl(url, {
        headers: existing?.etag ? { "If-None-Match": existing.etag } : {},
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (res.status === 304 && existing) {
        existing.fetchedAt = t;
        existing.retryAfter = 0;
      } else if (res.ok) {
        const data = (await res.json()) as { hosts?: unknown; entries?: unknown };
        const byPath = new Map<string, MapEntry>();
        if (Array.isArray(data.entries)) {
          for (const e of data.entries.slice(0, MAX_ENTRIES) as Record<string, unknown>[]) {
            if (typeof e?.from === "string" && typeof e?.to === "string") {
              byPath.set(e.from, { to: e.to, status: e.status === 302 ? 302 : 301 });
            }
          }
        }
        const hosts = Array.isArray(data.hosts) ? data.hosts.filter((h): h is string => typeof h === "string") : [];
        evictIfFull();
        cache.set(shop, {
          byPath,
          hosts,
          etag: res.headers.get("etag"),
          fetchedAt: t,
          retryAfter: 0,
          inflight: null,
        });
      } else if (res.status === 404) {
        // Shop unpublished/suspended/unknown: it has no redirects to serve.
        evictIfFull();
        cache.set(shop, { byPath: new Map(), hosts: [], etag: null, fetchedAt: t, retryAfter: 0, inflight: null });
      } else {
        throw new Error(`map ${res.status}`);
      }
      flushHits(shop);
    } catch {
      // Backend unreachable or slow: keep whatever we have, retry shortly.
      const current = cache.get(shop);
      if (current) current.retryAfter = t + RETRY_AFTER_FAILURE_MS;
      else {
        evictIfFull();
        cache.set(shop, {
          byPath: new Map(),
          hosts: [],
          etag: null,
          fetchedAt: t - REDIRECT_MAP_TTL_MS,
          retryAfter: t + RETRY_AFTER_FAILURE_MS,
          inflight: null,
        });
      }
    }
  }

  async function getMap(shop: string): Promise<CachedMap | null> {
    const t = now();
    const entry = cache.get(shop);
    if (entry && t - entry.fetchedAt < REDIRECT_MAP_TTL_MS) return entry;
    if (entry) {
      // Stale: serve it while one background refresh runs (never await it).
      if (!entry.inflight && t >= entry.retryAfter) {
        entry.inflight = refresh(shop).finally(() => {
          const live = cache.get(shop);
          if (live) live.inflight = null;
        });
      }
      return t - entry.fetchedAt < REDIRECT_MAP_STALE_MAX_MS ? entry : null;
    }
    // Cold: the first request for a shop waits (bounded by the fetch timeout).
    let pending = coldInflight.get(shop);
    if (!pending) {
      pending = refresh(shop).finally(() => coldInflight.delete(shop));
      coldInflight.set(shop, pending);
    }
    await pending;
    return cache.get(shop) ?? null;
  }

  async function lookup(shop: string, pathname: string, search: string): Promise<RedirectHit | null> {
    const path = canonicalizePath(pathname);
    if (path === null || path === "/") return null;
    const map = await getMap(shop);
    if (!map) return null;
    const hit = map.byPath.get(path);
    if (!hit) return null;
    const location = safeLocation(hit.to, search, map.hosts);
    if (location === null) return null;
    recordHit(shop, path);
    return { location, status: hit.status === 302 ? 302 : 301 };
  }

  return { lookup, _cacheSize: () => cache.size };
}
