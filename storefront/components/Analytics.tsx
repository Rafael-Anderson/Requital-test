"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useShop } from "@/lib/shop-context";
import { getConsent, onConsentChange } from "@/lib/consent";
import { initAnalytics, setAnalyticsConsent, track } from "@/lib/analytics";

// Wires lib/analytics.ts to the shop and the cookie banner. Renders nothing.
//
// It registers the shop's configured pixel ids and then waits for consent: with no
// "accepted" choice stored, setAnalyticsConsent(false) is the only thing that ever
// runs and no provider script is added to the page (see lib/analytics.ts). It never
// runs inside the theme builder's preview iframe, so editing a theme in admin
// cannot send a merchant's own page views to their ad platforms.
export default function Analytics() {
  const { shop, shopSlug, previewMode } = useShop();
  const pathname = usePathname();
  const analyticsConfig = shop?.analytics ?? null;
  const currency = shop?.currency;

  useEffect(() => {
    if (previewMode) return;
    initAnalytics(analyticsConfig, currency);
    setAnalyticsConsent(getConsent(shopSlug) === "accepted");
    return onConsentChange(shopSlug, (choice) => {
      setAnalyticsConsent(choice === "accepted");
      // The page the visitor is on at the moment they accept.
      if (choice === "accepted") track("page_view");
    });
  }, [analyticsConfig, currency, shopSlug, previewMode]);

  // An SPA never reloads, so each route change is reported by hand (a no-op until
  // consent has activated a provider). Declared after the effect above so, on a
  // returning visitor's first render, providers are already active.
  useEffect(() => {
    if (previewMode) return;
    track("page_view");
  }, [pathname, previewMode]);

  return null;
}
