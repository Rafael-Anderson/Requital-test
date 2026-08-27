import { describe, expect, it } from "vitest";
import { tabbyWidgetPublicKey, tamaraWidgetPublicKey } from "./bnpl-widgets";

const inStockProduct = { isGiftCard: false };
const giftCardProduct = { isGiftCard: true };

describe("tabbyWidgetPublicKey", () => {
  it("returns null when the shop has no Tabby public key configured", () => {
    expect(tabbyWidgetPublicKey(inStockProduct, { tabbyPublicKey: null })).toBeNull();
  });

  it("returns null when shop itself hasn't loaded yet", () => {
    expect(tabbyWidgetPublicKey(inStockProduct, null)).toBeNull();
    expect(tabbyWidgetPublicKey(inStockProduct, undefined)).toBeNull();
  });

  it("returns the key when configured", () => {
    expect(tabbyWidgetPublicKey(inStockProduct, { tabbyPublicKey: "pk_live_123" })).toBe("pk_live_123");
  });

  it("returns null for a gift card even when configured", () => {
    expect(tabbyWidgetPublicKey(giftCardProduct, { tabbyPublicKey: "pk_live_123" })).toBeNull();
  });
});

describe("tamaraWidgetPublicKey", () => {
  it("returns null when the shop has no Tamara public key configured", () => {
    expect(tamaraWidgetPublicKey(inStockProduct, { tamaraPublicKey: null })).toBeNull();
  });

  it("returns the key when configured", () => {
    expect(tamaraWidgetPublicKey(inStockProduct, { tamaraPublicKey: "pk_live_456" })).toBe("pk_live_456");
  });

  it("returns null for a gift card even when configured", () => {
    expect(tamaraWidgetPublicKey(giftCardProduct, { tamaraPublicKey: "pk_live_456" })).toBeNull();
  });
});
