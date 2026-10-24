import { describe, expect, it } from "vitest";
import { resolvePaymentMethods } from "./payment-methods";
import type { Shop } from "./types";

function shop(overrides: Partial<Shop>): Parameters<typeof resolvePaymentMethods>[0] {
  return {
    deliveryPaymentCardOnline: false,
    deliveryPaymentCashOnDelivery: false,
    deliveryPaymentCardOnDelivery: false,
    pickupPaymentCardOnline: false,
    pickupPaymentCashOnPickup: false,
    pickupPaymentCardOnPickup: false,
    cardProcessorEnabled: true,
    enabledPaymentProviders: [],
    ...overrides,
  };
}

describe("resolvePaymentMethods", () => {
  it("returns an empty list for a null shop", () => {
    expect(resolvePaymentMethods(null, "delivery")).toEqual([]);
    expect(resolvePaymentMethods(null, "pickup")).toEqual([]);
  });

  it("includes card_online for delivery only when both the flag and cardProcessorEnabled are true", () => {
    expect(resolvePaymentMethods(shop({ deliveryPaymentCardOnline: true, cardProcessorEnabled: true }), "delivery")).toContain(
      "card_online",
    );
  });

  it("excludes card_online when the flag is on but the shop's card processor is disabled", () => {
    const methods = resolvePaymentMethods(
      shop({ deliveryPaymentCardOnline: true, cardProcessorEnabled: false }),
      "delivery",
    );
    expect(methods).not.toContain("card_online");
  });

  it("excludes card_online when cardProcessorEnabled is true but the flag itself is off", () => {
    const methods = resolvePaymentMethods(
      shop({ deliveryPaymentCardOnline: false, cardProcessorEnabled: true }),
      "delivery",
    );
    expect(methods).not.toContain("card_online");
  });

  it("includes the plain cash/card-on-delivery methods independent of cardProcessorEnabled", () => {
    const methods = resolvePaymentMethods(
      shop({ deliveryPaymentCashOnDelivery: true, deliveryPaymentCardOnDelivery: true, cardProcessorEnabled: false }),
      "delivery",
    );
    expect(methods).toEqual(["cash_on_delivery", "card_on_delivery"]);
  });

  it("appends enabled independent providers to both delivery and pickup lists, unscoped by fulfillment type", () => {
    const s = shop({ enabledPaymentProviders: ["tabby", "paypal"] });
    expect(resolvePaymentMethods(s, "delivery")).toEqual(["tabby", "paypal"]);
    expect(resolvePaymentMethods(s, "pickup")).toEqual(["tabby", "paypal"]);
  });

  it("pickup mirrors the same card-processor gating as delivery, independently", () => {
    const s = shop({ pickupPaymentCardOnline: true, cardProcessorEnabled: false, deliveryPaymentCardOnline: true });
    expect(resolvePaymentMethods(s, "pickup")).not.toContain("card_online");
    expect(resolvePaymentMethods(s, "delivery")).not.toContain("card_online");
  });

  it("a fully unconfigured shop offers nothing for either context", () => {
    const s = shop({});
    expect(resolvePaymentMethods(s, "delivery")).toEqual([]);
    expect(resolvePaymentMethods(s, "pickup")).toEqual([]);
  });

  // F8: the server now reports cardProcessorEnabled / enabledPaymentProviders as
  // "usable" (toggled on AND real credentials), not merely toggled on, so a shop
  // whose gateway has no credentials offers no online method at all and never
  // sends the shopper to a payment that cannot be taken.
  it("offers only the cash methods when the server reports the online gateways unusable", () => {
    const s = shop({
      deliveryPaymentCardOnline: true,
      deliveryPaymentCashOnDelivery: true,
      pickupPaymentCardOnline: true,
      pickupPaymentCashOnPickup: true,
      cardProcessorEnabled: false,
      enabledPaymentProviders: [],
    });
    expect(resolvePaymentMethods(s, "delivery")).toEqual(["cash_on_delivery"]);
    expect(resolvePaymentMethods(s, "pickup")).toEqual(["cash_on_pickup"]);
  });
});
