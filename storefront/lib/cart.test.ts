import { describe, expect, it } from "vitest";
import { addItemToState, removeItemFromState, setQuantityInState, type CartState } from "./cart";

const empty: CartState = { outletId: null, items: [], discountCode: null, giftCardCode: null };
const item = { productId: 1, name: "Widget", price: 10, thumbnail: "x.jpg", maxStock: null as number | null };

describe("addItemToState", () => {
  it("adds a new item", () => {
    const next = addItemToState(empty, item, 2, 5);
    expect(next).toEqual({ outletId: 5, items: [{ ...item, quantity: 2 }], discountCode: null, giftCardCode: null });
  });

  it("increments quantity for an existing item", () => {
    const withItem = addItemToState(empty, item, 2, 5);
    const next = addItemToState(withItem, item, 3, 5);
    expect(next.items[0].quantity).toBe(5);
  });

  it("clamps to maxStock when adding", () => {
    const capped = { ...item, maxStock: 3 };
    const next = addItemToState(empty, capped, 10, 5);
    expect(next.items[0].quantity).toBe(3);
  });

  it("clamps to maxStock when incrementing an existing item", () => {
    const capped = { ...item, maxStock: 3 };
    const withItem = addItemToState(empty, capped, 2, 5);
    const next = addItemToState(withItem, capped, 5, 5);
    expect(next.items[0].quantity).toBe(3);
  });

  it("clears the cart when adding from a different outlet", () => {
    const withItem = addItemToState(empty, item, 1, 5);
    const otherItem = { ...item, productId: 2 };
    const next = addItemToState(withItem, otherItem, 1, 9);
    expect(next.outletId).toBe(9);
    expect(next.items).toEqual([{ ...otherItem, quantity: 1 }]);
  });

  it("does not clear the cart when adding from the same outlet", () => {
    const withItem = addItemToState(empty, item, 1, 5);
    const otherItem = { ...item, productId: 2 };
    const next = addItemToState(withItem, otherItem, 1, 5);
    expect(next.items).toHaveLength(2);
  });

  it("preserves an already-applied discount code when adding another item", () => {
    const withDiscount: CartState = { ...empty, discountCode: "SAVE10" };
    const next = addItemToState(withDiscount, item, 1, 5);
    expect(next.discountCode).toBe("SAVE10");
  });
});

describe("gift card lines", () => {
  const card100 = { productId: 5, name: "Gift Card", price: 100, thumbnail: "x.jpg", maxStock: null as number | null, isGiftCard: true };

  it("re-adding the same amount just increments quantity", () => {
    const withCard = addItemToState(empty, card100, 1, 5);
    const next = addItemToState(withCard, card100, 1, 5);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].quantity).toBe(2);
    expect(next.items[0].price).toBe(100);
  });

  it("re-adding a DIFFERENT amount replaces the line instead of merging quantity at the stale price", () => {
    const withCard = addItemToState(empty, card100, 1, 5);
    const card200 = { ...card100, price: 200 };
    const next = addItemToState(withCard, card200, 1, 5);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].price).toBe(200);
    expect(next.items[0].quantity).toBe(1);
  });
});

describe("setQuantityInState", () => {
  it("updates quantity, clamped to maxStock", () => {
    const capped = { ...item, maxStock: 4 };
    const state = addItemToState(empty, capped, 1, 5);
    const next = setQuantityInState(state, 1, 10);
    expect(next.items[0].quantity).toBe(4);
  });

  it("removes the item when quantity drops to 0 or below", () => {
    const state = addItemToState(empty, item, 1, 5);
    expect(setQuantityInState(state, 1, 0).items).toHaveLength(0);
    expect(setQuantityInState(state, 1, -1).items).toHaveLength(0);
  });
});

describe("removeItemFromState", () => {
  it("removes only the targeted item", () => {
    const state = addItemToState(addItemToState(empty, item, 1, 5), { ...item, productId: 2 }, 1, 5);
    const next = removeItemFromState(state, 1);
    expect(next.items.map((i) => i.productId)).toEqual([2]);
  });
});

describe("item notes", () => {
  it("carries a note through on a new line", () => {
    const withNote = { ...item, note: "No card, please" };
    const next = addItemToState(empty, withNote, 1, 5);
    expect(next.items[0].note).toBe("No card, please");
  });

  it("re-adding the same line with a new note overwrites the old one", () => {
    const withNote = addItemToState(empty, { ...item, note: "First note" }, 1, 5);
    const next = addItemToState(withNote, { ...item, note: "Second note" }, 1, 5);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].quantity).toBe(2);
    expect(next.items[0].note).toBe("Second note");
  });

  it("re-adding the same line with no note keeps the existing one", () => {
    const withNote = addItemToState(empty, { ...item, note: "Keep me" }, 1, 5);
    const next = addItemToState(withNote, item, 1, 5);
    expect(next.items[0].note).toBe("Keep me");
  });
});

describe("variant lines", () => {
  const small = { ...item, variantId: 10, variantLabel: "Small" };
  const large = { ...item, variantId: 20, variantLabel: "Large" };

  it("treats two variants of the same product as distinct lines", () => {
    const withSmall = addItemToState(empty, small, 1, 5);
    const next = addItemToState(withSmall, large, 1, 5);
    expect(next.items).toHaveLength(2);
  });

  it("increments quantity when adding the same variant again", () => {
    const withSmall = addItemToState(empty, small, 1, 5);
    const next = addItemToState(withSmall, small, 2, 5);
    expect(next.items).toHaveLength(1);
    expect(next.items[0].quantity).toBe(3);
  });

  it("setQuantity/removeItem only affect the targeted variant line", () => {
    const state = addItemToState(addItemToState(empty, small, 1, 5), large, 1, 5);
    const afterSetQty = setQuantityInState(state, 1, 5, 10);
    expect(afterSetQty.items.find((i) => i.variantId === 10)?.quantity).toBe(5);
    expect(afterSetQty.items.find((i) => i.variantId === 20)?.quantity).toBe(1);

    const afterRemove = removeItemFromState(state, 1, 10);
    expect(afterRemove.items).toHaveLength(1);
    expect(afterRemove.items[0].variantId).toBe(20);
  });
});
