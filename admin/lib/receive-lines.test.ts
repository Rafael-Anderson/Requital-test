import { describe, expect, it } from "vitest";
import { initialReceiveDrafts, outstanding, toReceiveInput } from "./receive-lines";
import type { PurchaseOrderLine } from "./types";

const line = (over: Partial<PurchaseOrderLine>): PurchaseOrderLine => ({
  id: 1,
  ingredientId: 4,
  productId: null,
  variantId: null,
  supplierSku: null,
  description: "Rose",
  quantityOrdered: 10,
  quantityReceived: 4,
  unitCost: "2",
  currency: "AED",
  lineTotal: "20",
  ...over,
});

describe("receive lines", () => {
  it("defaults to the outstanding quantity at the ordered price, skipping finished lines", () => {
    const lines = [line({}), line({ id: 2, quantityReceived: 10 })];
    expect(outstanding(lines[0])).toBe(6);
    expect(initialReceiveDrafts(lines)).toEqual([{ lineId: 1, quantity: "6", unitCost: "2" }]);
  });

  it("sends a unit cost only when it differs from the ordered price", () => {
    const lines = [line({})];
    expect(toReceiveInput([{ lineId: 1, quantity: "3", unitCost: "2" }], lines)).toEqual({
      input: { lines: [{ lineId: 1, quantity: 3 }] },
    });
    expect(toReceiveInput([{ lineId: 1, quantity: "3", unitCost: "2.5" }], lines)).toEqual({
      input: { lines: [{ lineId: 1, quantity: 3, unitCost: 2.5 }] },
    });
  });

  it("refuses more than is outstanding, fractions and an empty delivery", () => {
    const lines = [line({})];
    expect(toReceiveInput([{ lineId: 1, quantity: "7", unitCost: "2" }], lines)).toMatchObject({ error: expect.stringContaining("outstanding") });
    expect(toReceiveInput([{ lineId: 1, quantity: "1.5", unitCost: "2" }], lines)).toMatchObject({ error: expect.stringContaining("whole number") });
    expect(toReceiveInput([{ lineId: 1, quantity: "0", unitCost: "2" }], lines)).toEqual({ error: "Enter a quantity for at least one line." });
  });
});
