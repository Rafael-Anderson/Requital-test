import { describe, expect, it } from "vitest";
import { computeAutoDiscountedPrice } from "./auto-discounts";
import type { AutoDiscount } from "./types";

function fixtureProduct(overrides: Partial<{ id: number; price: string; collections: { id: number }[] }> = {}) {
  return { id: 1, price: "100", collections: [], ...overrides };
}

function fixtureDiscount(overrides: Partial<AutoDiscount> = {}): AutoDiscount {
  return {
    id: 1,
    type: "PERCENTAGE",
    value: "10",
    appliesTo: "SPECIFIC_PRODUCTS",
    productIds: [1],
    collectionIds: [],
    ...overrides,
  };
}

describe("computeAutoDiscountedPrice", () => {
  it("returns null when no discount matches the product", () => {
    const result = computeAutoDiscountedPrice(fixtureProduct(), [fixtureDiscount({ productIds: [999] })]);
    expect(result).toBeNull();
  });

  it("applies a percentage discount scoped to the product directly", () => {
    const result = computeAutoDiscountedPrice(fixtureProduct(), [fixtureDiscount({ type: "PERCENTAGE", value: "20" })]);
    expect(result).toEqual({ originalPrice: 100, discountedPrice: 80 });
  });

  it("applies a fixed-amount discount scoped via a collection the product belongs to", () => {
    const product = fixtureProduct({ collections: [{ id: 5 }] });
    const discount = fixtureDiscount({
      type: "FIXED_AMOUNT",
      value: "15",
      appliesTo: "SPECIFIC_COLLECTIONS",
      productIds: [],
      collectionIds: [5],
    });
    const result = computeAutoDiscountedPrice(product, [discount]);
    expect(result).toEqual({ originalPrice: 100, discountedPrice: 85 });
  });

  it("caps a fixed-amount discount at the product's own price rather than going negative", () => {
    const result = computeAutoDiscountedPrice(fixtureProduct({ price: "10" }), [
      fixtureDiscount({ type: "FIXED_AMOUNT", value: "50" }),
    ]);
    expect(result).toEqual({ originalPrice: 10, discountedPrice: 0 });
  });

  it("ignores FREE_SHIPPING discounts entirely — no product-price effect", () => {
    const result = computeAutoDiscountedPrice(fixtureProduct(), [fixtureDiscount({ type: "FREE_SHIPPING", value: "0" })]);
    expect(result).toBeNull();
  });

  it("never matches an ALL_PRODUCTS-scoped entry (not a valid auto-discount shape, backend-enforced)", () => {
    const result = computeAutoDiscountedPrice(fixtureProduct(), [
      fixtureDiscount({ appliesTo: "ALL_PRODUCTS", productIds: [], collectionIds: [] }),
    ]);
    expect(result).toBeNull();
  });

  it("picks the single best (largest) discount when more than one applies", () => {
    const product = fixtureProduct({ collections: [{ id: 5 }] });
    const smaller = fixtureDiscount({ type: "PERCENTAGE", value: "10" });
    const larger = fixtureDiscount({
      id: 2,
      type: "FIXED_AMOUNT",
      value: "30",
      appliesTo: "SPECIFIC_COLLECTIONS",
      productIds: [],
      collectionIds: [5],
    });
    const result = computeAutoDiscountedPrice(product, [smaller, larger]);
    expect(result).toEqual({ originalPrice: 100, discountedPrice: 70 });
  });
});
