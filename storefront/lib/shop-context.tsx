"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getShop, getThemeConfig, listOutlets } from "./api";
import { getReadableTextColor } from "./color-contrast";
import { WIRED_THEME_COLOR_FIELDS } from "./theme-colors";
import { captureReferralFromUrl } from "./referral";
import { isTrustedAdminOrigin } from "./theme-preview-origin";
import type { Outlet, Shop } from "./types";
import type { ThemeConfig } from "./theme-config-types";

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
  // New visual theme builder's published (or, in ?preview=true mode, draft)
  // config — null for a shop that's never published a new-system theme, in
  // which case every consumer falls back to its existing legacy dispatch
  // (shop.homepageLayout/topBarLayout/footerLayout/etc.). See
  // app/[shop]/page.tsx, TopBar.tsx, Footer.tsx.
  themeConfig: ThemeConfig | null;
  // True only when this page was loaded as the admin builder's live
  // preview iframe (?preview=true). Gates the postMessage listener below
  // and SectionWrapper's click-to-select reverse channel — never true for
  // a real shopper's storefront visit.
  previewMode: boolean;
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

const RADIUS_PX: Record<NonNullable<ThemeConfig["globalSettings"]["borderRadius"]>, string> = {
  sharp: "0px",
  soft: "8px",
  round: "9999px",
};

// New visual theme builder's global settings — applied as a second, smaller
// layer on top of applyTheme() above (not folded into resolveThemeCssVars,
// which stays a pure function with existing unit test coverage keyed on
// `Shop` alone) only when a shop has a published/previewed theme. Section
// components read --theme-radius directly; --color-accent/--color-accent-hover
// are the same vars every existing themed element already reads.
function applyThemeConfigOverrides(config: ThemeConfig | null) {
  const root = document.documentElement;
  const g = config?.globalSettings;
  if (!g) return;
  if (g.primaryColor && HEX_COLOR.test(g.primaryColor)) {
    root.style.setProperty("--color-accent", g.primaryColor);
    root.style.setProperty("--color-accent-foreground", getReadableTextColor(g.primaryColor));
  }
  if (g.secondaryColor && HEX_COLOR.test(g.secondaryColor)) {
    root.style.setProperty("--color-accent-hover", g.secondaryColor);
  }
  root.style.setProperty("--theme-radius", RADIUS_PX[g.borderRadius ?? "soft"]);
}

export function ShopProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shopBasePath = pathname === `/${shopSlug}` || pathname.startsWith(`/${shopSlug}/`) ? `/${shopSlug}` : "";
  const [shop, setShop] = useState<Shop | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [themeConfig, setThemeConfig] = useState<ThemeConfig | null>(null);

  const preview = searchParams.get("preview") === "true";
  const previewThemeId = searchParams.get("themeId");

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

  // Separate fetch from getShop/listOutlets above — a themeConfig fetch
  // failure (e.g. a stale/invalid preview themeId) shouldn't surface as a
  // whole-shop error page, it should just fall back to null (legacy
  // rendering). Re-fires when the preview query params change (the admin
  // editor's iframe src always carries a fixed themeId per session, but this
  // still needs to react to a genuine navigation between two preview
  // sessions or into/out of preview mode). This initial fetch covers a
  // direct refresh/navigation into the preview iframe; the postMessage
  // listener below overrides it after that with zero network round-trips,
  // per the spec's "no saving required to see changes in preview."
  useEffect(() => {
    getThemeConfig(shopSlug, {
      preview,
      themeId: previewThemeId ? Number(previewThemeId) : undefined,
    })
      .then(setThemeConfig)
      .catch(() => setThemeConfig(null));
  }, [shopSlug, preview, previewThemeId]);

  // Live preview sync — only registered in preview mode, never for a real
  // shopper visit. Validates event.origin against the known admin
  // origin(s) before accepting a config update; an untrusted origin (or a
  // malformed payload) is silently ignored, not applied.
  useEffect(() => {
    if (!preview) return;
    function handleMessage(event: MessageEvent) {
      if (!isTrustedAdminOrigin(event.origin)) return;
      if (event.data?.type === "theme-config-update" && event.data.config) {
        setThemeConfig(event.data.config as ThemeConfig);
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [preview]);

  useEffect(() => {
    applyTheme(shop);
  }, [shop]);

  useEffect(() => {
    applyThemeConfigOverrides(themeConfig);
  }, [themeConfig]);

  return (
    <ShopContext.Provider
      value={{ shopSlug, shopBasePath, shop, outlets, loading, error, themeConfig, previewMode: preview }}
    >
      {children}
    </ShopContext.Provider>
  );
}

export function useShop() {
  const ctx = useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used within ShopProvider");
  return ctx;
}
