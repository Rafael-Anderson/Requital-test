import { describe, expect, it } from "vitest";
import { resolveDeliveryTimeEstimate, formatDeliveryTimeLabel } from "./delivery-time";
import type { Product, Shop } from "./types";

function fakeShop(overrides: Partial<Shop> = {}): Shop {
  return {
    estimatedDeliveryTimeFrom: 30,
    estimatedDeliveryTimeTo: 60,
    estimatedDeliveryTimeUnit: "minutes",
    ...overrides,
  } as Shop;
}

function fakeProduct(overrides: Partial<Product> = {}): Product {
  return {
    estimatedDeliveryTimeFrom: null,
    estimatedDeliveryTimeTo: null,
    estimatedDeliveryTimeUnit: null,
    ...overrides,
  } as Product;
}

describe("resolveDeliveryTimeEstimate", () => {
  it("falls back to the shop default when the product has no override", () => {
    const result = resolveDeliveryTimeEstimate(fakeProduct(), fakeShop());
    expect(result).toEqual({ from: 30, to: 60, unit: "minutes" });
  });

  it("uses the product override when all three fields are set", () => {
    const product = fakeProduct({
      estimatedDeliveryTimeFrom: 1,
      estimatedDeliveryTimeTo: 1,
      estimatedDeliveryTimeUnit: "days",
    });
    const result = resolveDeliveryTimeEstimate(product, fakeShop());
    expect(result).toEqual({ from: 1, to: 1, unit: "days" });
  });

  it("treats a partial/malformed override as absent and falls back to the shop default", () => {
    const product = fakeProduct({ estimatedDeliveryTimeFrom: 2 }); // to/unit still null
    const result = resolveDeliveryTimeEstimate(product, fakeShop());
    expect(result).toEqual({ from: 30, to: 60, unit: "minutes" });
  });
});

describe("formatDeliveryTimeLabel", () => {
  it("30 minutes", () => {
    expect(formatDeliveryTimeLabel({ from: 30, to: 30, unit: "minutes" })).toBe("Delivered in 30 mins");
  });
  it("1 minute (singular)", () => {
    expect(formatDeliveryTimeLabel({ from: 1, to: 1, unit: "minutes" })).toBe("Delivered in 1 min");
  });
  it("1 hour (singular)", () => {
    expect(formatDeliveryTimeLabel({ from: 1, to: 1, unit: "hours" })).toBe("Delivered in 1 hour");
  });
  it("2 hours", () => {
    expect(formatDeliveryTimeLabel({ from: 2, to: 2, unit: "hours" })).toBe("Delivered in 2 hours");
  });
  it("next day (1 day, singular)", () => {
    expect(formatDeliveryTimeLabel({ from: 1, to: 1, unit: "days" })).toBe("Delivered next day");
  });
  it("2 days", () => {
    expect(formatDeliveryTimeLabel({ from: 2, to: 2, unit: "days" })).toBe("Delivered in 2 days");
  });
  it("a genuine minutes range", () => {
    expect(formatDeliveryTimeLabel({ from: 30, to: 60, unit: "minutes" })).toBe("Delivered in 30-60 minutes");
  });
  it("a genuine hours range", () => {
    expect(formatDeliveryTimeLabel({ from: 1, to: 2, unit: "hours" })).toBe("Delivered in 1-2 hours");
  });
  it("a genuine days range", () => {
    expect(formatDeliveryTimeLabel({ from: 2, to: 3, unit: "days" })).toBe("Delivered in 2-3 days");
  });
});
