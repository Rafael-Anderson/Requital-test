import { afterEach, describe, expect, it, vi } from "vitest";
import { createOrder } from "./api";
import type { CreateOrderPayload } from "./types";

afterEach(() => vi.unstubAllGlobals());

const base: CreateOrderPayload = {
  outletId: 1,
  orderType: "pickup",
  paymentMethod: "cash_on_pickup",
  customerName: "A",
  customerPhone: "0501234567",
  customerAddress: "x",
  items: [{ productId: 1, quantity: 1 }],
};

function stubFetch() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ order: { id: 1 } }), { status: 201, headers: { "Content-Type": "application/json" } }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("createOrder", () => {
  it("a guest checkout does not send credentials (unchanged)", async () => {
    const f = stubFetch();
    await createOrder("shop", base);
    expect(f.mock.calls[0][1]).not.toHaveProperty("credentials");
  });

  it("store credit goes through the session-carrying fetch and sends only the boolean", async () => {
    const f = stubFetch();
    await createOrder("shop", { ...base, useStoreCredit: true });
    const init = f.mock.calls[0][1] as RequestInit;
    expect(init.credentials).toBe("include");
    const sent = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(sent.useStoreCredit).toBe(true);
    expect(Object.keys(sent).some((k) => /amount/i.test(k) && k !== "giftCardAmount")).toBe(false);
  });
});
