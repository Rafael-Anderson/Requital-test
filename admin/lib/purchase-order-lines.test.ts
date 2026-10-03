import { describe, expect, it } from "vitest";
import { draftFromLine, newDraft, toLineInputs } from "./purchase-order-lines";
import type { PurchaseOrderLine } from "./types";

describe("toLineInputs", () => {
  it("maps ingredient, product and variant picks and omits a blank cost", () => {
    const res = toLineInputs([
      newDraft({ target: "i:5", quantity: "3", unitCost: "2.5" }),
      newDraft({ target: "p:9", quantity: "1", unitCost: "" }),
      newDraft({ target: "p:9:12", quantity: "2", unitCost: "0.0125" }),
    ]);
    expect(res).toEqual({
      lines: [
        { ingredientId: 5, quantity: 3, unitCost: 2.5 },
        { productId: 9, quantity: 1 },
        { productId: 9, variantId: 12, quantity: 2, unitCost: 0.0125 },
      ],
    });
  });

  it("reports the first invalid row", () => {
    expect(toLineInputs([])).toEqual({ error: "Add at least one line." });
    expect(toLineInputs([newDraft({ target: "" })])).toEqual({ error: "Line 1: choose an item." });
    expect(toLineInputs([newDraft({ target: "i:1", quantity: "1.5" })])).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(toLineInputs([newDraft({ target: "i:1", unitCost: "-1" })])).toMatchObject({ error: expect.stringContaining("zero or more") });
  });

  it("refuses the same item twice", () => {
    expect(toLineInputs([newDraft({ target: "i:1" }), newDraft({ target: "i:1" })])).toEqual({
      error: "The same item is on more than one line.",
    });
  });
});

describe("draftFromLine", () => {
  const base: PurchaseOrderLine = {
    id: 1,
    ingredientId: 4,
    productId: null,
    variantId: null,
    supplierSku: null,
    description: "Rose",
    quantityOrdered: 6,
    quantityReceived: 0,
    unitCost: "2.5",
    currency: "AED",
    lineTotal: "15",
  };
  it("round-trips an ingredient line and a shadow product line", () => {
    expect(draftFromLine(base)).toMatchObject({ target: "i:4", quantity: "6", unitCost: "2.5" });
    expect(draftFromLine({ ...base, ingredientId: 8, productId: 3, variantId: 7 })).toMatchObject({ target: "p:3:7" });
    expect(draftFromLine({ ...base, ingredientId: 8, productId: 3 })).toMatchObject({ target: "p:3" });
  });
});
