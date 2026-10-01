import { beforeEach, describe, expect, it } from "vitest";
import { buildPurchasePayload, stashPurchase, takeStashedPurchase } from "./purchase-tracking";

beforeEach(() => sessionStorage.clear());

describe("purchase tracking", () => {
  it("carries the order's own captured total/currency and the shared event id", () => {
    const p = buildPurchasePayload({ id: 42, total: "31.515", currency: "KWD" }, [{ id: 1, name: "x", price: 10.505, quantity: 3 }]);
    expect(p).toMatchObject({ transactionId: "42", eventId: "order_42", value: 31.515, currency: "KWD" });
  });

  it("the stash is single-use: a reload cannot send the purchase twice", () => {
    const p = buildPurchasePayload({ id: 7, total: "5", currency: "AED" }, []);
    stashPurchase(7, p);
    expect(takeStashedPurchase(7)).toEqual(p);
    expect(takeStashedPurchase(7)).toBeNull();
    expect(takeStashedPurchase(8)).toBeNull();
  });
});
