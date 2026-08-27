"use client";

import { useEffect, useRef } from "react";
import { loadScriptOnce } from "@/lib/load-script";

const TAMARA_WIDGET_SRC = "https://cdn.tamara.co/widget-v2/tamara-widget.js";

declare global {
  interface Window {
    tamaraWidgetConfig?: { lang: string; country: string; publicKey: string };
  }
}

// Tamara's lightweight installment-promo widget (docs.tamara.co/docs/direct-widgets)
// — separate from real Tamara checkout (payments/providers/tamara-payment.provider.ts),
// only needs price/country/publicKey and renders regardless of whether the
// full checkout integration is wired up. Only ever mounted when
// shop.tamaraPublicKey is non-null (see ProductDetailClient.tsx) — that
// field is already gated on the provider being enabled AND configured, so
// this component doesn't repeat that check.
//
// <tamara-widget> is a real custom element the widget script itself
// registers — created imperatively via the DOM (not JSX) so this file
// doesn't need a JSX.IntrinsicElements augmentation just for one external
// tag used in exactly one place.
export default function TamaraWidget({ price, publicKey }: { price: number; publicKey: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Must be set before the widget script itself runs — Tamara reads this
    // global once at script-execution/registration time, not per-element.
    window.tamaraWidgetConfig = { lang: "en", country: "AE", publicKey };
    let cancelled = false;
    loadScriptOnce(TAMARA_WIDGET_SRC)
      .then(() => {
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = "";
        const el = document.createElement("tamara-widget");
        el.setAttribute("type", "tamara-summary");
        // Tamara's own docs example is a plain decimal string ("250.0"), no
        // thousands separator.
        el.setAttribute("amount", price.toFixed(2));
        containerRef.current.appendChild(el);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [price, publicKey]);

  return <div ref={containerRef} />;
}
