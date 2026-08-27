"use client";

import { useEffect } from "react";
import { loadScriptOnce } from "@/lib/load-script";

const TABBY_PROMO_SRC = "https://checkout.tabby.ai/tabby-promo.js";
const CONTAINER_ID = "tabby-promo";

declare global {
  interface Window {
    TabbyPromo?: new (opts: {
      selector: string;
      currency: string;
      price: string;
      lang?: "en" | "ar";
      source?: "product" | "cart";
      publicKey: string;
      merchantCode: string;
    }) => unknown;
  }
}

// Tabby's lightweight "4 payments of X" installment-promo widget
// (docs.tabby.ai/pay-in-4-custom-integration/on-site-messaging) — separate
// from real Tabby checkout (payments/providers/tabby-payment.provider.ts),
// only needs price/currency/publicKey and renders regardless of whether the
// full checkout integration is wired up. Only ever mounted when
// shop.tabbyPublicKey is non-null (see ProductDetailClient.tsx) — that field
// is already gated on the provider being enabled AND configured, so this
// component doesn't repeat that check.
export default function TabbyPromoWidget({ price, currency, publicKey }: { price: number; currency: string; publicKey: string }) {
  useEffect(() => {
    let cancelled = false;
    loadScriptOnce(TABBY_PROMO_SRC)
      .then(() => {
        if (cancelled || !window.TabbyPromo) return;
        new window.TabbyPromo({
          selector: `#${CONTAINER_ID}`,
          currency,
          // Tabby's own docs: 2 decimal places for AED/SAR, no thousands
          // separator.
          price: price.toFixed(2),
          lang: "en",
          source: "product",
          publicKey,
          // This codebase's own real Tabby checkout integration already
          // treats the stored publicKey as the merchant_code value it sends
          // Tabby (see tabby-payment.provider.ts's createCheckoutSession) —
          // reused here rather than adding a second, redundant credential
          // field just for this promo widget.
          merchantCode: publicKey,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // Tabby's docs: re-init when the price changes (e.g. variant selection).
  }, [price, currency, publicKey]);

  return <div id={CONTAINER_ID} />;
}
