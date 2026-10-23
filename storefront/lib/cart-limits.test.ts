import { describe, expect, it } from "vitest";
import {
  addItemToState,
  clampCartState,
  lineAllowance,
  MAX_GIFT_CARD_UNITS,
  MAX_LINE_QUANTITY,
  MAX_ORDER_LINES,
  MAX_ORDER_UNITS,
  setQuantityInState,
  type CartItem,
  type CartState,
} from "./cart";

// F2: the server refuses an order over these limits (backend
// common/order-limits.ts), so the cart must never let the shopper build one.
const empty: CartState = { outletId: null, items: [], discountCode: null, giftCardCode: null };
const plain = (id: number, over: Partial<CartItem> = {}) => ({
  productId: id,
  name: `P${id}`,
  price: 10,
  thumbnail: "x.jpg",
  maxStock: null as number | null,
  ...over,
});
const line = (id: number, quantity: number, over: Partial<CartItem> = {}): CartItem => ({ ...plain(id, over), quantity });
const stateOf = (...items: CartItem[]): CartState => ({ ...empty, outletId: 1, items });

describe("the limits match the server's", () => {
  it("has the same numbers as backend/src/common/order-limits.ts", () => {
    expect([MAX_LINE_QUANTITY, MAX_ORDER_LINES, MAX_ORDER_UNITS, MAX_GIFT_CARD_UNITS]).toEqual([999, 100, 1000, 20]);
  });
});

describe("a line is capped at 999", () => {
  it("clamps an add", () => {
    expect(addItemToState(empty, plain(1), 5000, 1).items[0].quantity).toBe(999);
  });
  it("clamps an increment of an existing line", () => {
    const next = addItemToState(stateOf(line(1, 990)), plain(1), 50, 1);
    expect(next.items[0].quantity).toBe(999);
  });
  it("clamps setQuantity", () => {
    expect(setQuantityInState(stateOf(line(1, 2)), 1, 5000).items[0].quantity).toBe(999);
  });
  it("stock still wins when it is tighter", () => {
    expect(addItemToState(empty, plain(1, { maxStock: 7 }), 50, 1).items[0].quantity).toBe(7);
  });
});

describe("the whole cart is capped at 1000 units", () => {
  it("clamps the add that would cross it to what still fits", () => {
    const next = addItemToState(stateOf(line(1, 700)), plain(2), 500, 1);
    expect(next.items.find((i) => i.productId === 2)?.quantity).toBe(300);
  });
  it("does not add a new line at all once the cart is full", () => {
    const next = addItemToState(stateOf(line(1, 999), line(2, 1)), plain(3), 5, 1);
    expect(next.items.map((i) => i.productId)).toEqual([1, 2]);
  });
  it("clamps setQuantity against the other lines", () => {
    const next = setQuantityInState(stateOf(line(1, 800), line(2, 1)), 2, 900);
    expect(next.items[1].quantity).toBe(200);
  });
  it("says which limit stops the shopper", () => {
    const items = [line(1, 700), line(2, 300)];
    expect(lineAllowance(items, items[1])).toMatchObject({ orderMax: 300, message: "Maximum 1000 items per order" });
    expect(lineAllowance([line(1, 1)], line(1, 999))).toMatchObject({ orderMax: 999, message: "Maximum 999 per order" });
  });
  it("stays quiet when stock is the tighter limit (the stock note already says so)", () => {
    expect(lineAllowance([], line(1, 5, { maxStock: 5 })).message).toBeNull();
  });
});

describe("gift cards are capped at 20 per order across lines", () => {
  const gc = (id: number, q: number) => line(id, q, { isGiftCard: true });
  it("clamps an add of a gift card line", () => {
    expect(addItemToState(empty, plain(1, { isGiftCard: true }), 50, 1).items[0].quantity).toBe(20);
  });
  it("counts the gift cards already in the cart on other lines", () => {
    const next = addItemToState(stateOf(gc(1, 15)), plain(2, { isGiftCard: true, price: 200 }), 10, 1);
    expect(next.items[1].quantity).toBe(5);
  });
  it("does not count plain products against it", () => {
    const next = addItemToState(stateOf(line(9, 500)), plain(2, { isGiftCard: true }), 20, 1);
    expect(next.items[1].quantity).toBe(20);
  });
  it("names the gift card limit", () => {
    expect(lineAllowance([], gc(1, 20)).message).toBe("Maximum 20 gift cards per order");
  });
});

describe("at most 100 lines", () => {
  const many = Array.from({ length: MAX_ORDER_LINES }, (_, i) => line(i + 1, 1));
  it("refuses a 101st line but still adds to an existing one", () => {
    expect(addItemToState(stateOf(...many), plain(500), 1, 1).items).toHaveLength(MAX_ORDER_LINES);
    expect(addItemToState(stateOf(...many), plain(1), 2, 1).items[0].quantity).toBe(3);
  });
});

describe("clampCartState: a cart saved before the limits are clamped, not broken", () => {
  it("returns a within-limits cart untouched (same object)", () => {
    const s = stateOf(line(1, 3), line(2, 4));
    expect(clampCartState(s)).toBe(s);
  });
  it("cuts an over-cap line and keeps the cart", () => {
    const s = stateOf(line(1, 4000), line(2, 4));
    const next = clampCartState(s);
    expect(next.items.map((i) => [i.productId, i.quantity])).toEqual([[1, 999], [2, 1]]);
    expect(next.discountCode).toBeNull();
  });
  it("cuts later lines to what fits and drops those with no room", () => {
    const s = stateOf(line(1, 999), line(2, 5), line(3, 5));
    expect(clampCartState(s).items.map((i) => [i.productId, i.quantity])).toEqual([[1, 999], [2, 1]]);
  });
  it("caps gift cards and keeps the code fields", () => {
    const s: CartState = { ...stateOf(line(1, 80, { isGiftCard: true })), discountCode: "SAVE10", giftCardCode: "G" };
    const next = clampCartState(s);
    expect(next.items[0].quantity).toBe(20);
    expect(next.discountCode).toBe("SAVE10");
    expect(next.giftCardCode).toBe("G");
  });
  it("drops lines past the 100th", () => {
    const s = stateOf(...Array.from({ length: 130 }, (_, i) => line(i + 1, 1)));
    expect(clampCartState(s).items).toHaveLength(100);
  });
  it("does not apply stale stock (maxStock is only as fresh as the last add)", () => {
    const s = stateOf(line(1, 5, { maxStock: 2 }));
    expect(clampCartState(s)).toBe(s);
  });
});
