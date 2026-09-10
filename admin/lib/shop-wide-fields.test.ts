import { describe, expect, it } from "vitest";
import { diffShopWideChanges, SHOP_WIDE_FIELD_LABELS } from "./shop-wide-fields";

describe("diffShopWideChanges", () => {
  it("returns nothing when no shop-wide value changed (the no-dialog path)", () => {
    const payload = { taxRate: 5, taxInclusive: true, allowSameDayOrders: true };
    expect(diffShopWideChanges(payload, payload)).toEqual([]);
    expect(diffShopWideChanges({ ...payload }, { ...payload })).toEqual([]);
  });

  it("names the tax rate when it changes", () => {
    expect(
      diffShopWideChanges({ taxRate: 5, taxInclusive: true }, { taxRate: 7.5, taxInclusive: true }),
    ).toEqual(["Tax Rate (%)"]);
  });

  it("collapses the three payment-method columns into one line", () => {
    const before = {
      deliveryPaymentCardOnline: true,
      deliveryPaymentCashOnDelivery: true,
      deliveryPaymentCardOnDelivery: false,
    };
    const after = {
      deliveryPaymentCardOnline: false,
      deliveryPaymentCashOnDelivery: false,
      deliveryPaymentCardOnDelivery: false,
    };
    expect(diffShopWideChanges(before, after)).toEqual(["Delivery payment methods"]);
  });

  it("collapses the three estimated-delivery-time inputs into one line", () => {
    const before = {
      estimatedDeliveryTimeFrom: 30,
      estimatedDeliveryTimeTo: 60,
      estimatedDeliveryTimeUnit: "minutes",
    };
    const after = {
      estimatedDeliveryTimeFrom: 1,
      estimatedDeliveryTimeTo: 2,
      estimatedDeliveryTimeUnit: "hours",
    };
    expect(diffShopWideChanges(before, after)).toEqual(["Estimated Delivery Time"]);
  });

  it("detects a nested business-hours change", () => {
    const before = { deliveryHours: { mon: { open: "09:00", close: "18:00", closed: false } } };
    const after = { deliveryHours: { mon: { open: "10:00", close: "18:00", closed: false } } };
    expect(diffShopWideChanges(before, after)).toEqual(["Opening Hours for Delivery"]);
  });

  it("treats a null <-> string cutoff transition as a change", () => {
    expect(diffShopWideChanges({ sameDayCutoffTime: null }, { sameDayCutoffTime: "14:00" })).toEqual([
      "Same-day order cutoff",
    ]);
    expect(diffShopWideChanges({ sameDayCutoffTime: "14:00" }, { sameDayCutoffTime: null })).toEqual([
      "Same-day order cutoff",
    ]);
  });

  it("lists several changed fields at once, deduped", () => {
    const before = {
      taxRate: 5,
      taxInclusive: true,
      allowSameDayOrders: true,
      allowNextDayOrders: true,
    };
    const after = {
      taxRate: 5,
      taxInclusive: false,
      allowSameDayOrders: false,
      allowNextDayOrders: true,
    };
    expect(diffShopWideChanges(before, after)).toEqual(["Same-day orders", "Tax Type"]);
  });

  it("ignores keys that are not shop-wide fields", () => {
    expect(diffShopWideChanges({ name: "Marina" }, { name: "Marina Branch" })).toEqual([]);
  });

  it("warns about everything in the payload when there is no baseline yet", () => {
    expect(diffShopWideChanges(null, { taxRate: 5, taxInclusive: true })).toEqual([
      "Tax Rate (%)",
      "Tax Type",
    ]);
  });

  it("keeps every label non-empty so the dialog never renders a blank row", () => {
    for (const [key, label] of Object.entries(SHOP_WIDE_FIELD_LABELS)) {
      expect(label.trim(), `label for ${key}`).not.toBe("");
    }
  });
});
