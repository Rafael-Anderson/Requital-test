import { describe, expect, it, vi } from "vitest";
import {
  REDIRECT_MAP_STALE_MAX_MS,
  REDIRECT_MAP_TTL_MS,
  canonicalizePath,
  createRedirectStore,
  safeLocation,
} from "./redirect-map";

const HOSTS = ["acme.requital.io", "shop.acme.com"];

describe("canonicalizePath", () => {
  it("lowercases, drops the trailing slash and the query, re-encodes segments", () => {
    expect(canonicalizePath("/Products/Rose/")).toBe("/products/rose");
    expect(canonicalizePath("/products/rose?utm=1#x")).toBe("/products/rose");
    expect(canonicalizePath("/p/%D8%B9")).toBe("/p/%D8%B9");
  });
  it("returns null for anything unsafe or malformed", () => {
    for (const bad of ["x", "/a//b", "/%zz", "/a/%2f/b", "/a/%5c", "/a/..", "/a/%00", "x".repeat(5000)]) {
      expect(canonicalizePath(bad)).toBeNull();
    }
  });
});

describe("safeLocation (open-redirect defence)", () => {
  it("keeps a plain path and carries the visitor's query to a target without one", () => {
    expect(safeLocation("/new", "", HOSTS)).toBe("/new");
    expect(safeLocation("/new", "?utm=1", HOSTS)).toBe("/new?utm=1");
    expect(safeLocation("/new?a=1", "?utm=1", HOSTS)).toBe("/new?a=1");
    expect(safeLocation("/new#frag", "?utm=1", HOSTS)).toBe("/new?utm=1#frag");
  });

  it("percent-encodes a non-ASCII path so the Location header stays valid", () => {
    expect(safeLocation("/products/" + String.fromCharCode(0x0639), "", HOSTS)).toBe("/products/%D8%B9");
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "/\\evil.com",
    "\\\\evil.com",
    "/\t/evil.com",
    "/\r\n/evil.com",
    "javascript:alert(1)",
    "data:text/html,x",
    "evil.com",
    "",
    "https://evil.com/x",
    "https://acme.requital.io.evil.com/x",
    "https://evilacme.requital.io/x",
    "https://user@acme.requital.io/x",
    "https://acme.requital.io:8443/x",
    "ftp://acme.requital.io/x",
  ])("refuses %j", (to) => {
    expect(safeLocation(to, "", HOSTS)).toBeNull();
  });

  it("allows an absolute URL on the shop's own hosts only", () => {
    expect(safeLocation("https://shop.acme.com/x", "", HOSTS)).toBe("https://shop.acme.com/x");
    expect(safeLocation("https://shop.acme.com/x", "?a=1", HOSTS)).toBe("https://shop.acme.com/x?a=1");
    // The host list is what the backend sent: without the custom domain, refused.
    expect(safeLocation("https://shop.acme.com/x", "", ["acme.requital.io"])).toBeNull();
  });
});

function mapResponse(entries: { from: string; to: string; status?: number }[], etag = '"v1"') {
  return new Response(JSON.stringify({ hosts: HOSTS, entries: entries.map((e) => ({ status: 301, ...e })) }), {
    status: 200,
    headers: { etag },
  });
}

describe("createRedirectStore", () => {
  it("resolves a redirect from the cached map with ONE backend fetch for many requests", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => mapResponse([{ from: "/old", to: "/new" }]));
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    for (let i = 0; i < 50; i += 1) {
      expect(await store.lookup("acme", "/OLD/", "?x=1")).toEqual({ location: "/new?x=1", status: 301 });
    }
    expect(await store.lookup("acme", "/other", "")).toBeNull();
    const maps = fetchImpl.mock.calls.filter((c) => String(c[0]).endsWith("/redirects/map"));
    expect(maps).toHaveLength(1);
  });

  it("keys the cache by shop: one shop's redirects never answer for another", async () => {
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("/public/acme/") ? mapResponse([{ from: "/old", to: "/acme-new" }]) : mapResponse([]),
    );
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    expect(await store.lookup("acme", "/old", "")).toEqual({ location: "/acme-new", status: 301 });
    expect(await store.lookup("other", "/old", "")).toBeNull();
    expect(await store.lookup("acme", "/old", "")).not.toBeNull();
  });

  it("never serves an unsafe target even if the backend sent one", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      mapResponse([
        { from: "/a", to: "//evil.com" },
        { from: "/b", to: "https://evil.com" },
        { from: "/c", to: "javascript:alert(1)" },
        { from: "/d", to: "/fine" },
      ]),
    );
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    expect(await store.lookup("acme", "/a", "")).toBeNull();
    expect(await store.lookup("acme", "/b", "")).toBeNull();
    expect(await store.lookup("acme", "/c", "")).toBeNull();
    expect(await store.lookup("acme", "/d", "")).toEqual({ location: "/fine", status: 301 });
  });

  it("never redirects the home page or a path that cannot be canonicalised", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => mapResponse([{ from: "/", to: "/x" }]));
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    expect(await store.lookup("acme", "/", "")).toBeNull();
    expect(await store.lookup("acme", "/a//b", "")).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("revalidates with If-None-Match after the TTL and keeps the map on a 304", async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const headers = init?.headers as Record<string, string> | undefined;
      if (headers?.["If-None-Match"] === '"v1"') return new Response(null, { status: 304 });
      return mapResponse([{ from: "/old", to: "/new" }]);
    });
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl, now: () => t });
    await store.lookup("acme", "/old", "");
    t += REDIRECT_MAP_TTL_MS + 1;
    // Stale: answered from the old map immediately, refreshed in the background.
    expect(await store.lookup("acme", "/old", "")).toEqual({ location: "/new", status: 301 });
    await vi.waitFor(() => {
      expect(fetchImpl.mock.calls.some((c) => (c[1]?.headers as Record<string, string>)?.["If-None-Match"] === '"v1"')).toBe(true);
    });
    t += 1000;
    expect(await store.lookup("acme", "/old", "")).toEqual({ location: "/new", status: 301 });
  });

  it("serves the stale map when the backend is down, then stops after the stale limit", async () => {
    let t = 1_000_000;
    let down = false;
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      if (down) throw new Error("ECONNREFUSED");
      return mapResponse([{ from: "/old", to: "/new" }]);
    });
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl, now: () => t });
    await store.lookup("acme", "/old", "");
    down = true;
    t += REDIRECT_MAP_TTL_MS + 1;
    expect(await store.lookup("acme", "/old", "")).not.toBeNull();
    await new Promise((r) => setTimeout(r, 0));
    t += REDIRECT_MAP_STALE_MAX_MS;
    expect(await store.lookup("acme", "/old", "")).toBeNull();
  });

  it("never throws and never blocks a page when the backend is down on a cold start", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("ECONNREFUSED");
    });
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    await expect(store.lookup("acme", "/old", "")).resolves.toBeNull();
    // A failure is not retried on every request.
    await store.lookup("acme", "/old", "");
    await store.lookup("acme", "/old", "");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("treats a 404 (unpublished or suspended shop) as no redirects", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 404 }));
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    expect(await store.lookup("acme", "/old", "")).toBeNull();
  });

  it("batches hit counts and sends them with the next refresh", async () => {
    let t = 1_000_000;
    const fetchImpl = vi.fn(async (url: string, _init?: RequestInit) =>
      url.endsWith("/hits") ? new Response(null, { status: 204 }) : mapResponse([{ from: "/old", to: "/new" }]),
    );
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl, now: () => t });
    for (let i = 0; i < 3; i += 1) await store.lookup("acme", "/old", "");
    expect(fetchImpl.mock.calls.some((c) => String(c[0]).endsWith("/hits"))).toBe(false);
    t += REDIRECT_MAP_TTL_MS + 1;
    await store.lookup("acme", "/old", "");
    await vi.waitFor(() => {
      const call = fetchImpl.mock.calls.find((c) => String(c[0]).endsWith("/hits"));
      expect(call).toBeDefined();
      expect(JSON.parse(String(call![1]?.body))).toEqual({ hits: [{ path: "/old", count: 4 }] });
    });
  });

  it("bounds the number of cached shops", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => mapResponse([]));
    const store = createRedirectStore({ apiUrl: "http://api", fetchImpl });
    for (let i = 0; i < 600; i += 1) await store.lookup(`shop-${i}`, "/x", "");
    expect(store._cacheSize()).toBeLessThanOrEqual(500);
  });
});
