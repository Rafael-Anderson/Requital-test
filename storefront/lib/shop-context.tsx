"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { getShop, listOutlets } from "./api";
import { getReadableTextColor } from "./color-contrast";
import { WIRED_THEME_COLOR_FIELDS } from "./theme-colors";
import { captureReferralFromUrl } from "./referral";
import type { Outlet, Shop } from "./types";

interface ShopContextValue {
  shopSlug: string;
  // Internal links must adapt to how THIS request reached the app:
  // proxy.ts rewrites a hostname-resolved request (subdomain/custom domain)
  // onto /[shop]/... server-side, invisibly to the browser's own address
  // bar — so on that path, an internal href must be root-relative (no
  // prefix), since the browser has no /{shop} in its URL to begin with. But
  // proxy.ts deliberately leaves bare localhost/127.0.0.1 alone (no per-shop
  // host to resolve there), so local dev and the e2e suite (see
  // e2e/urls.ts) still navigate via a literal /{shop}/... path, where the
  // browser's address bar DOES carry the prefix — an unprefixed href there
  // would 404. shopBasePath is "" in the first case, "/${shopSlug}" in the
  // second, detected from the CURRENT pathname (the one signal available
  // that's always correct regardless of which flow got us here).
  shopBasePath: string;
  shop: Shop | null;
  outlets: Outlet[];
  loading: boolean;
  error: string | null;
}

const ShopContext = createContext<ShopContextValue | null>(null);

const DEFAULT_ACCENT = "#069494";
const DEFAULT_ACCENT_HOVER = "#057a7a";
const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function darken(hex: string, amount = 0.15): string {
  const num = parseInt(hex.replace("#", ""), 16);
  const channel = (shift: number) => {
    const value = Math.round(((num >> shift) & 255) * (1 - amount));
    return Math.max(0, value).toString(16).padStart(2, "0");
  };
  return `#${channel(16)}${channel(8)}${channel(0)}`;
}

// Pure CSS-var resolution — no DOM access — so the fallback/override logic
// (which is exactly the kind of thing that shipped a real contrast bug
// earlier in this project) is directly testable. applyTheme() below just
// loops over the result and calls root.style.setProperty.
//
// No OS prefers-color-scheme handling here (there was, briefly, via a
// DARK_MODE_DEFAULTS map + a matchMedia listener in applyTheme — removed,
// see the storefront dark-mode-mismatch bug report). --background is just
// another entry in WIRED_THEME_COLOR_FIELDS now (Page Background Color,
// defaulting to white — see theme-colors.ts), always resolved from the
// merchant's own setting like every other field in this loop, never from a
// visitor's OS preference the shop never opted into.
export function resolveThemeCssVars(shop: Shop | null): Record<string, string> {
  const accent = shop?.brandColor && HEX_COLOR.test(shop.brandColor) ? shop.brandColor : DEFAULT_ACCENT;
  const accentHover =
    shop?.secondaryColor && HEX_COLOR.test(shop.secondaryColor) ? shop.secondaryColor : darken(accent) || DEFAULT_ACCENT_HOVER;

  const vars: Record<string, string> = {
    "--color-accent": accent,
    "--color-accent-hover": accentHover,
    "--color-accent-foreground": getReadableTextColor(accent),
    "--font-sans": `var(--font-${shop?.fontFamily ?? "inter"})`,
  };

  // Granular Appearance Color overrides — only the fields with a real
  // storefront element to apply to (see theme-colors.ts).
  const colors = shop?.colors ?? {};
  for (const field of WIRED_THEME_COLOR_FIELDS) {
    const override = colors[field.key];
    vars[field.cssVar] = override && HEX_COLOR.test(override) ? override : field.default;
  }

  // Add to Cart Text is the one exception among the wired fields: an
  // explicit override is honored (handled by the loop above), but an unset
  // value falls back to the same auto-contrast guard as --color-accent-
  // foreground (never a hardcoded white) rather than its own static default.
  const addToCartButton =
    colors.addToCartButtonColor && HEX_COLOR.test(colors.addToCartButtonColor) ? colors.addToCartButtonColor : "#069494";
  if (!(colors.addToCartTextColor && HEX_COLOR.test(colors.addToCartTextColor))) {
    vars["--color-add-to-cart-text"] = getReadableTextColor(addToCartButton);
  }

  // Derived (not a saved field of its own), same pattern as
  // --color-accent-foreground — auto-contrast text for bg-button, so a
  // merchant picking a near-white Button Color can't ship unreadable text.
  const buttonColor = colors.buttonColor && HEX_COLOR.test(colors.buttonColor) ? colors.buttonColor : "#069494";
  vars["--color-button-foreground"] = getReadableTextColor(buttonColor);

  return vars;
}

// Applies (or resets to Requital's teal default) the CSS custom properties
// every storefront component already reads via bg-accent/text-accent/etc.
// — see globals.css. Runs on every `shop` change, including the initial
// null state before the fetch resolves, so a client-side navigation between
// two different shops' storefronts in the same tab can never leave a
// previous tenant's colors/font applied while the next one loads (an SPA-
// specific leak a plain "only set if present" effect would have).
function applyTheme(shop: Shop | null) {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(resolveThemeCssVars(shop))) {
    root.style.setProperty(name, value);
  }
}

export function ShopProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const shopBasePath = pathname === `/${shopSlug}` || pathname.startsWith(`/${shopSlug}/`) ? `/${shopSlug}` : "";
  const [shop, setShop] = useState<Shop | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Runs on every page under this shop, not just checkout — a ?ref=<code>
    // can land on any page (product link, homepage) and must survive
    // browsing until checkout. See lib/referral.ts.
    captureReferralFromUrl(shopSlug);
  }, [shopSlug]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setShop(null);
    Promise.all([getShop(shopSlug), listOutlets(shopSlug)])
      .then(([shopRes, outletsRes]) => {
        setShop(shopRes);
        setOutlets(outletsRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load shop"))
      .finally(() => setLoading(false));
  }, [shopSlug]);

  useEffect(() => {
    applyTheme(shop);
  }, [shop]);

  return (
    <ShopContext.Provider value={{ shopSlug, shopBasePath, shop, outlets, loading, error }}>
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used within ShopProvider");
  return ctx;
}
