"use client";

// Tabby's real, official on-site-messaging widget — https://checkout.tabby.ai/tabby-promo.js
// (verified against https://docs.tabby.ai/pay-in-4-custom-integration/on-site-messaging).
// Renders and computes its own installment breakdown/legal copy; nothing
// here hand-writes any of that. publicKey/merchantCode are the shop's own
// public-safe credentials (see PaymentSettingsService.resolvePublicWidgetKey
// / resolveTabbyMerchantCode) — never the secret key, which never leaves
// the backend.
import { useEffect, useRef } from "react";
import { loadScriptOnce } from "@/lib/load-script";

const CONTAINER_ID = "tabby-promo";
const SCRIPT_SRC = "https://checkout.tabby.ai/tabby-promo.js";

interface TabbyPromoConfig {
  selector: string;
  currency: string;
  price: string;
  lang?: string;
  source?: string;
  publicKey: string;
  merchantCode: string;
}

declare global {
  interface Window {
    TabbyPromo?: new (config: TabbyPromoConfig) => void;
  }
}

export default function TabbyPromoWidget({
  publicKey,
  merchantCode,
  price,
  currency,
  onLoadError,
}: {
  publicKey: string;
  merchantCode: string;
  price: string;
  currency: string;
  onLoadError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadScriptOnce(SCRIPT_SRC)
      .then(() => {
        if (cancelled || !window.TabbyPromo || !containerRef.current) return;
        // Re-init on price/currency/key change (e.g. a variant swap) —
        // Tabby's own docs say to reinit on price changes; clearing first
        // avoids stacking a second render inside the same container.
        containerRef.current.innerHTML = "";
        new window.TabbyPromo({
          selector: `#${CONTAINER_ID}`,
          currency: currency.toUpperCase(),
          price: Number(price).toFixed(2),
          lang: "en",
          source: "product",
          publicKey,
          merchantCode,
        });
      })
      .catch(() => {
        if (!cancelled) onLoadError();
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, merchantCode, price, currency, onLoadError]);

  return <div id={CONTAINER_ID} ref={containerRef} />;
}
