import { describe, expect, it } from "vitest";
import { paymentBadges } from "./payment-badges";
import type { Shop } from "@/lib/types";

function baseShop(overrides: Partial<Shop> = {}): Shop {
  return {
    cardProcessorEnabled: false,
    deliveryPaymentCashOnDelivery: false,
    pickupPaymentCashOnPickup: false,
    enabledPaymentProviders: [],
    ...overrides,
  } as Shop;
}

describe("paymentBadges", () => {
  it("returns nothing when no payment method is enabled", () => {
    expect(paymentBadges(baseShop())).toEqual([]);
  });

  it("adds a card badge when the card processor is enabled", () => {
    const badges = paymentBadges(baseShop({ cardProcessorEnabled: true }));
    expect(badges.map((b) => b.key)).toEqual(["card"]);
  });

  it("adds a cash badge for either delivery or pickup COD", () => {
    expect(paymentBadges(baseShop({ deliveryPaymentCashOnDelivery: true })).map((b) => b.key)).toEqual(["cash"]);
    expect(paymentBadges(baseShop({ pickupPaymentCashOnPickup: true })).map((b) => b.key)).toEqual(["cash"]);
  });

  it("adds one badge per enabled BNPL/gateway provider, capitalised", () => {
    const badges = paymentBadges(baseShop({ enabledPaymentProviders: ["tabby", "tamara"] }));
    expect(badges.map((b) => ({ key: b.key, label: b.label }))).toEqual([
      { key: "tabby", label: "Tabby" },
      { key: "tamara", label: "Tamara" },
    ]);
  });

  it("combines card, cash, and providers in order", () => {
    const badges = paymentBadges(
      baseShop({ cardProcessorEnabled: true, deliveryPaymentCashOnDelivery: true, enabledPaymentProviders: ["paypal"] }),
    );
    expect(badges.map((b) => b.key)).toEqual(["card", "cash", "paypal"]);
  });
});
