import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveImageUrl, listProducts, getProduct, getStoredAuth, setStoredAuth, getMyOrders } from "./api";
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

// Same per-shop-namespaced localStorage pattern as lib/cart.tsx's own
// tests — a logged-in session on one shop's storefront must never leak into
// another's, same guarantee cart/referral already have.
describe("customer auth storage", () => {
  afterEach(() => {
    localStorage.clear();
  });

  it("round-trips a stored session", () => {
    expect(getStoredAuth("acme-shop")).toBeNull();
    const auth = { accessToken: "a", refreshToken: "r", customer: testCustomer };
    setStoredAuth("acme-shop", auth);
    expect(getStoredAuth("acme-shop")).toEqual(auth);
  });

  it("clears the session when set to null", () => {
    setStoredAuth("acme-shop", { accessToken: "a", refreshToken: "r", customer: testCustomer });
    setStoredAuth("acme-shop", null);
    expect(getStoredAuth("acme-shop")).toBeNull();
  });

  it("scopes storage per shop — one shop's session is invisible under another shop's key", () => {
    setStoredAuth("shop-a", { accessToken: "a", refreshToken: "r", customer: testCustomer });
    expect(getStoredAuth("shop-b")).toBeNull();
    expect(getStoredAuth("shop-a")).not.toBeNull();
  });

  it("returns null for corrupt JSON rather than throwing", () => {
    localStorage.setItem("requital_storefront_auth:acme-shop", "{not json");
    expect(getStoredAuth("acme-shop")).toBeNull();
  });
});

describe("authenticated requests", () => {
  afterEach(() => {
    localStorage.clear();
    vi.unstubAllGlobals();
  });

  it("attaches the Authorization header from the stored session", async () => {
    setStoredAuth("acme-shop", { accessToken: "secret-token", refreshToken: "r", customer: testCustomer });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "[]" });
    vi.stubGlobal("fetch", fetchMock);

    await getMyOrders("acme-shop");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer secret-token");
  });

  it("sends no Authorization header when no session is stored (never crashes a guest call)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, text: async () => "[]" });
    vi.stubGlobal("fetch", fetchMock);

    await getMyOrders("acme-shop");

    const [, init] = fetchMock.mock.calls[0];
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
  });
});
