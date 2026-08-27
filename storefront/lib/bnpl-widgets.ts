import type { Product, Shop } from "./types";

// Pure (no React) so the PDP's "which BNPL promo widget, if any, should
// render, and with which key" decision is directly unit-testable without
// standing up a full ProductDetailClient render harness (that component has
// no existing test suite and depends on next/navigation's
// useParams/useRouter, unlike the pure-logic modules this app's vitest
// suite otherwise covers). Returns the key itself, not just a boolean, so
// the call site's JSX conditional (`{tabbyWidgetPublicKey(...) && <... />}`)
// narrows to a real string for the widget's required `publicKey` prop
// instead of needing a second, easily-drifting truthiness check duplicated
// in JSX. Both widgets are promotional only (see
// TabbyPromoWidget.tsx/TamaraWidget.tsx's own comments) — gated on
// shop.tabbyPublicKey/tamaraPublicKey, which the backend already resolves
// to null unless that provider is both enabled for checkout AND has a real
// public key configured (see PaymentSettingsService.resolvePublicWidgetKey)
// — never shown for a gift card, which has no BNPL-installment concept.
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
