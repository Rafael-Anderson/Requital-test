// @vitest-environment node
import { createHmac } from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clientIpFromForwardedFor, internalAuthHeaders, signInternal } from "./internal-auth";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("signInternal", () => {
  it("is HMAC-SHA256 over METHOD, PATH and t (matches the backend's verifier)", async () => {
    const expected = createHmac("sha256", "s".repeat(32)).update("GET\n/domains/resolve\n1700000000").digest("hex");
    expect(await signInternal("s".repeat(32), "get", "/domains/resolve", 1700000000)).toBe(`t=1700000000,sig=${expected}`);
  });
});

describe("internalAuthHeaders", () => {
  it("sends nothing when INTERNAL_API_SECRET is unset (fail closed = today's behaviour)", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "");
    expect(await internalAuthHeaders("GET", "http://127.0.0.1:3000/domains/resolve?host=a.b")).toEqual({});
  });

  it("signs the path without the query and forwards the client ip only when given", async () => {
    vi.stubEnv("INTERNAL_API_SECRET", "k".repeat(32));
    vi.useFakeTimers();
    vi.setSystemTime(new Date(1700000000_000));
    const h = await internalAuthHeaders("GET", "http://127.0.0.1:3000/domains/resolve?host=a.b", "203.0.113.9");
    const sig = createHmac("sha256", "k".repeat(32)).update("GET\n/domains/resolve\n1700000000").digest("hex");
    expect(h).toEqual({ "X-Internal-Auth": `t=1700000000,sig=${sig}`, "X-Internal-Client-IP": "203.0.113.9" });
    expect(Object.keys(await internalAuthHeaders("GET", "http://x/y"))).toEqual(["X-Internal-Auth"]);
  });
});

describe("clientIpFromForwardedFor", () => {
  it("takes the right-most entry (the one Caddy wrote)", () => {
    expect(clientIpFromForwardedFor("6.6.6.6, 203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpFromForwardedFor("203.0.113.9")).toBe("203.0.113.9");
    expect(clientIpFromForwardedFor(null)).toBeUndefined();
    expect(clientIpFromForwardedFor("")).toBeUndefined();
  });
});
