import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveImageUrl, listProducts, getProduct, getMyOrders, loginCustomer, updateMyProfile } from "./api";
import type { Customer } from "./types";

function mockFetchOnce(body: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({ ok: true, json: async () => body }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveImageUrl", () => {
  it("prefixes a backend-relative path with the API origin", () => {
    expect(resolveImageUrl("/uploads/products/x.jpg")).toBe("http://localhost:3000/uploads/products/x.jpg");
  });

  it("leaves an absolute URL untouched", () => {
    expect(resolveImageUrl("https://cdn.example.com/x.jpg")).toBe("https://cdn.example.com/x.jpg");
  });

  it("returns null for null/undefined", () => {
    expect(resolveImageUrl(null)).toBeNull();
    expect(resolveImageUrl(undefined)).toBeNull();
  });
});

// Regression test for the uploaded-image 404 bug: product.thumbnail comes
// back from the backend as a relative /uploads/... path, but the storefront
// renders on a different origin (:3002) than the API (:3000) — an
// unresolved thumbnail 404s. listProducts/getProduct must resolve it before
// the Product ever reaches a component.
describe("product thumbnail resolution (regression)", () => {
  it("listProducts resolves a relative thumbnail to an absolute API URL", async () => {
    mockFetchOnce([{ id: 1, name: "Widget", thumbnail: "/uploads/products/x.jpg" }]);
    const [product] = await listProducts("acme-shop");
    expect(product.thumbnail).toBe("http://localhost:3000/uploads/products/x.jpg");
  });

  it("getProduct resolves a relative thumbnail to an absolute API URL", async () => {
    mockFetchOnce({ id: 1, name: "Widget", thumbnail: "/uploads/products/x.jpg" });
    const product = await getProduct("acme-shop", 1);
    expect(product.thumbnail).toBe("http://localhost:3000/uploads/products/x.jpg");
  });

  it("leaves an already-absolute thumbnail (external/seed data) untouched", async () => {
    mockFetchOnce({ id: 1, name: "Widget", thumbnail: "https://cdn.example.com/x.jpg" });
    const product = await getProduct("acme-shop", 1);
    expect(product.thumbnail).toBe("https://cdn.example.com/x.jpg");
  });
});

const testCustomer: Customer = {
  id: 1,
  shopId: 1,
  name: "Jane Doe",
  phone: "0501234567",
  email: null,
  emailVerified: false,
  registeredAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
};

// Session-cookie migration (security audit finding #1), phase 3 — the
// customer session is an httpOnly cookie now (set/sent by the browser
// automatically), not a bearer token this app stores or attaches by hand.
// These tests cover what's left on this side: every request is credentialed
// (so the cookie actually rides along), and the CSRF token — held in memory
// only, distributed via the X-CSRF-Token *response* header (see
// lib/api.ts's own comment for why not a readable cookie) — is captured
// from responses and echoed back on the next state-changing request.
describe("credentialed requests and CSRF token handling", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function mockFetch(headers: Record<string, string> = {}, body: unknown = "[]") {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: (name: string) => headers[name] ?? null },
      text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
      json: async () => body,
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("sends credentials: include on an authenticated GET (so the session cookie actually rides along)", async () => {
    const fetchMock = mockFetch();

    await getMyOrders("acme-shop");

    const [, init] = fetchMock.mock.calls[0];
    expect(init.credentials).toBe("include");
  });

  it("captures the CSRF token from a login response's X-CSRF-Token header and echoes it back on the next state-changing request, but not on a GET", async () => {
    mockFetch({ "X-CSRF-Token": "fresh-csrf-token" }, { customer: testCustomer });
    await loginCustomer("acme-shop", { identifier: "0501234567", password: "pw" });

    const getMock = mockFetch();
    await getMyOrders("acme-shop");
    const [, getInit] = getMock.mock.calls[0];
    expect((getInit.headers as Record<string, string>)["X-CSRF-Token"]).toBeUndefined();

    const patchMock = mockFetch();
    await updateMyProfile("acme-shop", { name: "New Name" });
    const [, patchInit] = patchMock.mock.calls[0];
    expect((patchInit.headers as Record<string, string>)["X-CSRF-Token"]).toBe("fresh-csrf-token");
  });

  it("never sends an Authorization header (no bearer token exists anymore)", async () => {
    const fetchMock = mockFetch();

    await getMyOrders("acme-shop");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
