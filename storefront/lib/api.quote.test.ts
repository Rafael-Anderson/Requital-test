import { afterEach, describe, expect, it, vi } from "vitest";
import { quoteDelivery } from "./api";

afterEach(() => vi.restoreAllMocks());

const req = { outletId: 1, orderType: "pickup" as const, items: [{ productId: 1, quantity: 1 }] };
const ok = (headers: Record<string, string> = {}) =>
  new Response(JSON.stringify({ status: "pickup_free" }), { status: 201, headers });

// A logged-in shopper carries the customer session cookie, and the backend 403s any
// POST under /public/:shop without the CSRF header, so the quote must go through the
// same authenticated client createOrder uses for a session.
describe("quoteDelivery (customer session + CSRF)", () => {
  it("sends the cookie and, once a CSRF token is known, the X-CSRF-Token header", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(ok({ "X-CSRF-Token": "tok-1" }))
      .mockResolvedValueOnce(ok());
    await quoteDelivery("shop", req);
    await quoteDelivery("shop", req);
    const first = fetchMock.mock.calls[0][1] as RequestInit;
    const second = fetchMock.mock.calls[1][1] as RequestInit;
    expect(first.credentials).toBe("include");
    expect(second.credentials).toBe("include");
    expect((second.headers as Record<string, string>)["X-CSRF-Token"]).toBe("tok-1");
    expect(second.method).toBe("POST");
  });
});
