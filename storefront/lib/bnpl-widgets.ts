import type { Product, Shop } from "./types";

// Pure (no React) so the PDP's "is this BNPL provider available to promote"
// decision is directly unit-testable without standing up a full
// ProductDetailClient render harness. Returns the key string (not a bool)
// so a future consumer that actually needs the key still can; the current
// caller (BnplWidgetCard, static copy only) just checks presence. Gated on
// shop.tabbyPublicKey/tamaraPublicKey, which the backend resolves to null
// unless that provider is both enabled for checkout AND has a real public
// key configured (see PaymentSettingsService.resolvePublicWidgetKey) —
// never shown for a gift card, which has no BNPL-installment concept.
export function tabbyWidgetPublicKey(
  product: Pick<Product, "isGiftCard">,
  shop: Pick<Shop, "tabbyPublicKey"> | null | undefined,
): string | null {
  if (product.isGiftCard) return null;
  return shop?.tabbyPublicKey ?? null;
}

export function tamaraWidgetPublicKey(
  product: Pick<Product, "isGiftCard">,
  shop: Pick<Shop, "tamaraPublicKey"> | null | undefined,
): string | null {
  if (product.isGiftCard) return null;
  return shop?.tamaraPublicKey ?? null;
}
