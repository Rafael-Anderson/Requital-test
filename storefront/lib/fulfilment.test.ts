import { describe, expect, it } from "vitest";
import { effectiveOrderType, fulfilmentUnavailableMessage, resolveFulfilmentOptions } from "./fulfilment";

type ShopArg = Parameters<typeof resolveFulfilmentOptions>[0];

function shop(overrides: Partial<NonNullable<ShopArg>> = {}): ShopArg {
  return {
    deliveryPaymentCardOnline: false,
    deliveryPaymentCashOnDelivery: true,
    deliveryPaymentCardOnDelivery: false,
    pickupPaymentCardOnline: false,
    pickupPaymentCashOnPickup: true,
    pickupPaymentCardOnPickup: false,
    cardProcessorEnabled: true,
    enabledPaymentProviders: [],
    ...overrides,
  };
}

describe("resolveFulfilmentOptions", () => {
  it("both: outlet offers delivery and pickup", () => {
    expect(resolveFulfilmentOptions(shop(), { deliveryEnabled: true, pickupEnabled: true })).toEqual({
      delivery: true,
      pickup: true,
      mode: "both",
    });
  });

  it("delivery only", () => {
    expect(resolveFulfilmentOptions(shop(), { deliveryEnabled: true, pickupEnabled: false })).toMatchObject({
      delivery: true,
      pickup: false,
      mode: "delivery",
    });
  });

  it("pickup only", () => {
    expect(resolveFulfilmentOptions(shop(), { deliveryEnabled: false, pickupEnabled: true })).toMatchObject({
      delivery: false,
      pickup: true,
      mode: "pickup",
    });
  });

  it("neither: the outlet offers nothing", () => {
    expect(resolveFulfilmentOptions(shop(), { deliveryEnabled: false, pickupEnabled: false })).toEqual({
      delivery: false,
      pickup: false,
      mode: "none",
      reason: "outlet_offers_neither",
    });
  });

  it("neither: no outlet at all", () => {
    expect(resolveFulfilmentOptions(shop(), null)).toMatchObject({ mode: "none", reason: "no_outlet" });
  });

  it("a type with no payment method is not offered, even when the outlet toggle is on", () => {
    const noPickupPayment = shop({ pickupPaymentCashOnPickup: false });
    expect(resolveFulfilmentOptions(noPickupPayment, { deliveryEnabled: true, pickupEnabled: true }).mode).toBe("delivery");
    const noPayment = shop({ deliveryPaymentCashOnDelivery: false, pickupPaymentCashOnPickup: false });
    expect(resolveFulfilmentOptions(noPayment, { deliveryEnabled: true, pickupEnabled: true })).toMatchObject({
      mode: "none",
      reason: "no_payment_methods",
    });
  });

  it("is evaluated per outlet: A delivery only, B pickup only", () => {
    const a = resolveFulfilmentOptions(shop(), { deliveryEnabled: true, pickupEnabled: false });
    const b = resolveFulfilmentOptions(shop(), { deliveryEnabled: false, pickupEnabled: true });
    expect([a.mode, b.mode]).toEqual(["delivery", "pickup"]);
  });
});

describe("effectiveOrderType", () => {
  const both = { delivery: true, pickup: true, mode: "both" as const };
  const deliveryOnly = { delivery: true, pickup: false, mode: "delivery" as const };
  const pickupOnly = { delivery: false, pickup: true, mode: "pickup" as const };
  const none = { delivery: false, pickup: false, mode: "none" as const };

  it("keeps the shopper's preference when the outlet offers it", () => {
    expect(effectiveOrderType(both, "pickup")).toBe("pickup");
    expect(effectiveOrderType(both, "delivery")).toBe("delivery");
  });

  it("falls to the only type an outlet offers, never an invalid combination", () => {
    expect(effectiveOrderType(deliveryOnly, "pickup")).toBe("delivery");
    expect(effectiveOrderType(pickupOnly, "delivery")).toBe("pickup");
  });

  it("is null when nothing is offered", () => {
    expect(effectiveOrderType(none, "delivery")).toBeNull();
  });
});

describe("fulfilmentUnavailableMessage", () => {
  it("never contains an em dash and differs by reason", () => {
    const all = [undefined, "no_outlet", "no_payment_methods", "outlet_offers_neither"].map((r) =>
      fulfilmentUnavailableMessage(r as never),
    );
    all.forEach((m) => expect(m).not.toContain("—"));
    expect(new Set(all).size).toBeGreaterThan(2);
  });
});
