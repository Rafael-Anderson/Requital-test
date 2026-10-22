// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// proxy.ts keeps module-level caches, so every test imports a fresh copy.
async function load() {
  vi.resetModules();
  return (await import("./proxy")).proxy;
}

function req(path = "/", host = "acme.requital.io") {
  return new NextRequest(`https://${host}${path}`, { headers: { host } });
}

type Answer = { status: number; body?: unknown; headers?: Record<string, string> } | "throw";
let answer: Answer;
let resolveCalls: number;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  answer = { status: 200, body: { subdomain: "acme" } };
  resolveCalls = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (!String(url).includes("/domains/resolve")) return new Response(null, { status: 404 });
      resolveCalls += 1;
      if (answer === "throw") throw new Error("ECONNREFUSED");
      return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
        status: answer.status,
        headers: answer.headers,
      });
    }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const rewriteOf = (res: Response) => res.headers.get("x-middleware-rewrite") ?? "";

describe("proxy host resolution", () => {
  it("rewrites a resolved host onto the shop tree", async () => {
    const proxy = await load();
    expect(rewriteOf(await proxy(req("/")))).toContain("/acme/");
  });

  it("answers a real 404 for a host the backend says is unknown", async () => {
    const proxy = await load();
    answer = { status: 404 };
    const res = await proxy(req());
    expect(res.status).toBe(404);
    expect(rewriteOf(res)).toContain("/store-not-found");
  });

  it.each([
    ["429 throttled", { status: 429, headers: { "Retry-After": "7" } } as Answer, "7"],
    ["503 backend down", { status: 503 } as Answer, "5"],
    ["500 backend error", { status: 500 } as Answer, "5"],
    ["network error", "throw" as Answer, "5"],
  ])("never turns %s into a 404 (no known-good entry): 503 + Retry-After + no-store", async (_n, a, retry) => {
    const proxy = await load();
    answer = a;
    const res = await proxy(req());
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe(retry);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(rewriteOf(res)).not.toContain("store-not-found");
  });

  it("serves the last known good subdomain when the backend throttles or fails", async () => {
    const proxy = await load();
    await proxy(req());
    vi.setSystemTime(Date.now() + 60_000); // past the 30s positive cache
    for (const a of [{ status: 429 }, { status: 503 }, "throw"] as Answer[]) {
      answer = a;
      expect(rewriteOf(await proxy(req()))).toContain("/acme/");
    }
  });

  it("does not serve a stale entry for a host the backend now says is unknown", async () => {
    const proxy = await load();
    await proxy(req());
    vi.setSystemTime(Date.now() + 60_000);
    answer = { status: 404 };
    expect((await proxy(req())).status).toBe(404);
    answer = { status: 503 };
    expect((await proxy(req())).status).toBe(503); // the stale entry was dropped by the 404
  });

  it("stops serving a stale entry after the grace period", async () => {
    const proxy = await load();
    await proxy(req());
    vi.setSystemTime(Date.now() + 6 * 60_000);
    answer = { status: 503 };
    expect((await proxy(req())).status).toBe(503);
  });

  it("caches a positive answer for 30s and coalesces concurrent cold lookups", async () => {
    const proxy = await load();
    await Promise.all([proxy(req()), proxy(req()), proxy(req())]);
    expect(resolveCalls).toBe(1);
    await proxy(req());
    expect(resolveCalls).toBe(1);
    vi.setSystemTime(Date.now() + 31_000);
    await proxy(req());
    expect(resolveCalls).toBe(2);
  });

  it("treats a 200 with an unreadable body as unavailable, not as an unknown host", async () => {
    const proxy = await load();
    answer = { status: 200, body: undefined };
    expect((await proxy(req())).status).toBe(503);
  });
});
