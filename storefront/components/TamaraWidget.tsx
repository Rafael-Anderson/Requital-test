"use client";

// Tamara's real, official product-page widget — https://cdn.tamara.co/widget-v2/tamara-widget.js
// (verified against https://docs.tamara.co/docs/shopify-widgets, cross-checked
// against this repo's own prior implementation before it was removed).
// Renders and computes its own installment breakdown/legal copy; nothing
// here hand-writes any of that. `publicKey` is the shop's own public-safe
// credential (see PaymentSettingsService.resolvePublicWidgetKey) — never
// the secret apiToken, which never leaves the backend. No separate
// "currency" param — the widget infers it from `country`.
import { useEffect, useRef } from "react";
import { loadScriptOnce } from "@/lib/load-script";

const SCRIPT_SRC = "https://cdn.tamara.co/widget-v2/tamara-widget.js";

declare global {
  interface Window {
    tamaraWidgetConfig?: { lang: string; country: string; publicKey: string };
  }
}

export default function TamaraWidget({
  publicKey,
  price,
  country = "AE",
  onLoadError,
}: {
  publicKey: string;
  price: string;
  // AED-only shop today (see root CLAUDE.md) — hardcode "AE" until
  // multi-currency/multi-country lands, at which point this should come
  // from the shop's real country instead.
  country?: string;
  onLoadError: () => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    // Must be set before the script loads — the script reads this global
    // at load time, not per-widget-instance.
    window.tamaraWidgetConfig = { lang: "en", country, publicKey };
    loadScriptOnce(SCRIPT_SRC)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        // Re-init on price/publicKey/country change (e.g. a variant swap) —
        // rebuild the custom element rather than mutating attributes in
        // place, matching Tabby's own "reinit on changes" guidance.
        containerRef.current.innerHTML = "";
        const el = document.createElement("tamara-widget");
        el.setAttribute("type", "tamara-summary");
        el.setAttribute("amount", Number(price).toFixed(2));
        containerRef.current.appendChild(el);
      })
      .catch(() => {
        if (!cancelled) onLoadError();
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey, price, country, onLoadError]);

  return <div ref={containerRef} />;
}
