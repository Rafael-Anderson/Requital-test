"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { getShop, getThemeConfig, listActiveAutoDiscounts, listOutlets } from "./api";
import { resolveThemeCssVars } from "./theme-css-vars";
import { applyMotionCssVars } from "./motion";
import { applyRadiusCssVars, resolveThemeRadius } from "./radius";
import { applyDensityCssVars } from "./density";
import { applyCardHoverCssVars } from "./card-hover";
import { captureReferralFromUrl } from "./referral";
import { isTrustedAdminOrigin } from "./theme-preview-origin";
import { resolveScheme } from "./theme-color-scheme";
import { resolveLetterSpacing, resolveLineHeight, resolveScaleSizes, resolveTypographyPairing } from "./theme-typography";
import type { AutoDiscount, Outlet, Shop } from "./types";
import type { ColorScheme, HeadingTextPreset, ThemeConfig } from "./theme-config-types";

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
  // The previewing staff member's own JWT, carried in via ?previewToken=
  // (see admin's PreviewFrame.tsx) — undefined outside preview mode. Every
  // fetch that's gated by PublicService.assertPublishedOrPreview (outlets,
  // menu, collections, products) needs this passed through so an unpublished
  // shop's own staff can preview it before ever going live; see that
  // method's own comment for why a bare ?preview=true flag isn't enough.
  previewToken: string | undefined;
  // Every live auto-apply discount for this shop, fetched once per session —
  // ProductCard/PDP compute their own struck-through price from this list
  // via lib/auto-discounts.ts, with zero customer action needed. Empty
  // array (not null) before the fetch resolves, same as `outlets`, since a
  // "no auto discounts yet" shop and "still loading" shop render identically
  // (no strikethrough) either way.
  autoDiscounts: AutoDiscount[];
}

const ShopContext = createContext<ShopContextValue | null>(null);

// resolveThemeCssVars now lives in lib/theme-css-vars.ts (non-"use client")
// so app/[shop]/layout.tsx can emit these server-side; re-exported here
// (imported at the top of this file) since existing callers/tests import it
// from this module.
export { resolveThemeCssVars };

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

// Layout mode's 13 categories (button shape, button fill, icon style,
// homepage layout, ...) are the legacy `themesettings` row, admin-side
// lifted into useThemeEditor.legacyTheme and posted here as
// {type: "legacy-theme-update", legacyTheme} (see PreviewFrame.tsx's own
// comment on why this is a second message type rather than folded into
// theme-config-update — two genuinely different JSON shapes from two
// different backend endpoints).
//
// Every one of these field names already exists on Shop itself
// (storefront/lib/types.ts) — a live (non-preview) storefront visit already
// gets the current values for free from GET /public/:shopSlug, and every
// consumer already reads them off `shop` directly (iconStyleProps(shop?.
// iconStyle, ...) in ThemeDrivenHeader, storeButtonClassName(shop) in
// button-style.ts, the shop.homepageLayout dispatch in app/[shop]/page.tsx,
// etc.) — not off some separate concept. So rather than introduce a second,
// parallel "legacyTheme" context field nothing else would read (which would
// just create a NEW inconsistency between two copies of the same data),
// the postMessage handler merges the received fields straight into `shop`
// state. That's what makes this fix cover all 13 categories at once: every
// one of those pre-existing shop.* consumers starts reflecting live
// Layout-mode edits in preview for free, not just the two new CSS vars
// below.
const LEGACY_THEME_SHOP_FIELDS = [
  "homepageLayout",
  "homeTabMode",
  "topBarLayout",
  "iconStyle",
  "buttonRadius",
  "buttonFill",
  "pdpLayout",
  "cartLayout",
  "checkoutLayout",
  "footerLayout",
  "headerDensity",
  "footerDensity",
  "collectionsGridColumns",
  "collectionsGridGap",
  "collectionsGridShowTitle",
  "collectionsGridImageAspectRatio",
] as const satisfies readonly (keyof Shop)[];

function mergeLegacyThemeIntoShop(shop: Shop, legacyTheme: Record<string, unknown>): Shop {
  const patch: Partial<Shop> = {};
  for (const field of LEGACY_THEME_SHOP_FIELDS) {
    if (field in legacyTheme) (patch as Record<string, unknown>)[field] = legacyTheme[field];
  }
  return { ...shop, ...patch };
}

const BUTTON_RADIUS_PX: Record<string, string> = {
  sharp: "0px",
  rounded: "8px",
  pill: "9999px",
};

// New, additive wiring surface: the pre-existing legacy consumers above
// (storeButtonClassName, iconStyleProps, the homepageLayout dispatch) are
// class/prop-based, not CSS vars, and already cover the OLD, non-theme-
// builder rendering path (ClassicHero, checkout, cart, PDP). The new
// theme-driven sections (HeroSection/ProductGridSection/NewsletterSection)
// have no legacy-aware button styling at all — these two vars are what
// let THOSE components' buttons respect Layout mode's Button shape/fill
// too. Deliberately takes legacy precedence over the new Buttons category's
// own --theme-radius (set in applyThemeConfigOverrides) for these two
// properties specifically — Button shape/fill is what this fix is actually
// about, and --theme-radius is otherwise always present once a shop has
// any theme.config at all, which would silently shadow legacy forever
// otherwise. A real, flagged precedence call between two independently-
// editable systems, not an oversight.
function applyLegacyThemeOverrides(shop: Shop | null) {
  const root = document.documentElement;
  root.style.setProperty("--theme-btn-primary-radius", BUTTON_RADIUS_PX[shop?.buttonRadius ?? "rounded"] ?? "8px");
  root.style.setProperty("--theme-btn-fill", shop?.buttonFill ?? "solid");
}

const PAGE_WIDTH_PX: Record<ThemeConfig["globalSettings"]["pageLayout"]["width"], string> = {
  narrow: "960px",
  normal: "1280px",
  wide: "1600px",
};

const HEADING_KEYS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

function applyHeadingPreset(root: CSSStyleDeclaration, key: string, preset: HeadingTextPreset) {
  root.setProperty(`--text-${key}-size`, `${preset.size}px`);
  root.setProperty(`--text-${key}-line-height`, String(resolveLineHeight(preset.lineHeight)));
  root.setProperty(`--text-${key}-letter-spacing`, resolveLetterSpacing(preset.letterSpacing));
  root.setProperty(`--text-${key}-transform`, preset.case === "uppercase" ? "uppercase" : "none");
  // Each heading level independently picks the heading or accent font role
  // (HeadingTextPreset.font) — resolved to whichever of those two roles'
  // already-loaded font vars it names, so h1-h6 can genuinely differ from
  // each other, not just share one global heading font.
  root.setProperty(`--text-${key}-font`, preset.font === "accent" ? "var(--theme-accent-font, inherit)" : "var(--theme-heading-font, inherit)");
}

// next/font/google requires statically-known font imports at build time —
// it cannot load a font chosen at runtime from DB-stored config (that's how
// the legacy shop.fontFamily/--font-sans mechanism works, and why it's
// limited to a curated 4-font list). A dynamic <link> tag is the standard
// workaround, at the cost of next/font's self-hosting/layout-shift-avoidance
// benefits — the accepted trade-off for arbitrary Google Fonts selection.
// Module-level Set (not component state) so the same family is never
// injected twice across re-renders or shop navigations in one tab session.
const loadedGoogleFonts = new Set<string>();
function loadGoogleFont(family: string | undefined) {
  if (!family || loadedGoogleFonts.has(family)) return;
  loadedGoogleFonts.add(family);
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
  document.head.appendChild(link);
}

// The active color scheme (globalSettings.colorSchemes[0]) → the CSS custom
// properties every storefront surface already reads. Pure + exported so
// shop-context.test.ts can assert the mapping without a DOM.
//   button      → --color-accent / --color-accent-hover  (bg-accent buttons)
//   buttonLabel → --color-accent-foreground              (text on those buttons)
//   background  → --background / --color-header           (page canvas + header base)
//   text        → --foreground / --color-header-fg / --color-product-name  (main text)
// secondaryButtonLabel is deliberately left unmapped — no "secondary" button
// variant renders anywhere in theme-sections/* (same status as
// globalSettings.buttons.secondary / pillCornerRadius, already flagged in
// applyThemeConfigOverrides below).
// --color-header is the LOWEST-priority header input: ThemeDrivenHeader's
// `header.settings.background` and ShopLayoutClient's
// `nav_menu.settings.headerBackgroundColor` are inline styles that shadow
// it, so on a shop that sets its header background either of those ways the
// scheme background won't visibly move the header — page canvas / body text
// / product names still update.
export function resolveSchemeCssVars(scheme: ColorScheme | null | undefined): Record<string, string> {
  if (!scheme) return {};
  return {
    "--color-accent": scheme.button,
    "--color-accent-hover": scheme.button,
    "--color-accent-foreground": scheme.buttonLabel,
    "--background": scheme.background,
    "--color-header": scheme.background,
    "--foreground": scheme.text,
    "--color-header-fg": scheme.text,
    "--color-product-name": scheme.text,
  };
}

// New visual theme builder's global settings — applied as a second, smaller
// layer on top of applyTheme() above (not folded into resolveThemeCssVars,
// which stays a pure function with existing unit test coverage keyed on
// `Shop` alone) only when a shop has a published/previewed theme. Section
// components read --theme-radius/--theme-body-font/--theme-heading-font
// directly; --color-accent/--color-accent-hover are the same vars every
// existing themed element already reads.
function applyThemeConfigOverrides(config: ThemeConfig | null) {
  const root = document.documentElement;
  const g = config?.globalSettings;
  if (!g) return;

  // Default active scheme is the first entry in colorSchemes — there's no
  // separate "defaultSchemeId" field; a section/badge/drawer/popover can
  // still reference a different scheme by id via its own schemeId (see
  // theme-color-scheme.ts's resolveScheme, used at those call sites).
  const scheme = resolveScheme(g.colorSchemes[0]?.id, g.colorSchemes);
  for (const [name, value] of Object.entries(resolveSchemeCssVars(scheme))) {
    root.style.setProperty(name, value);
  }

  // Popovers/modals surface — mega-menu flyout, nav dropdown panel, header
  // search results. globalSettings.popovers.schemeId was a dead setting
  // (see storefront/CLAUDE.md's "no consumer" list); wired here now.
  // Falls back to the default active scheme so a themed shop that never
  // picked a popover scheme still gets themed popovers, not hardcoded white.
  // --color-popover-border is only overridden when the scheme defines one;
  // otherwise it keeps its globals.css default (#e4e4e7, the old hardcoded
  // value).
  const popoverScheme = resolveScheme(g.popovers?.schemeId, g.colorSchemes) ?? scheme;
  if (popoverScheme) {
    root.style.setProperty("--color-popover", popoverScheme.background);
    root.style.setProperty("--color-popover-fg", popoverScheme.text);
    if (popoverScheme.border) root.style.setProperty("--color-popover-border", popoverScheme.border);
  }

  root.style.setProperty("--theme-max-width", PAGE_WIDTH_PX[g.pageLayout?.width ?? "normal"]);

  // Phase B1 — the discounted-price colour (ProductCard.tsx's PriceDisplay
  // reads `text-sale-price`). Always written (overwrite-healed on cross-shop
  // nav, like the scheme vars); unset ⇒ #dc2626 = the old hardcoded
  // `text-red-600`.
  root.style.setProperty("--color-sale-price", g.prices?.salePriceColor || "#dc2626");

  // Phase B1 — typography.pairing: when a bundle resolves, it sources the 4
  // font roles and the per-role bodyFont/headingFont/accentFont/subheadingFont
  // reads below are skipped. Unset ⇒ those per-role blocks run as today.
  const pairing = resolveTypographyPairing(g.typography?.pairing);
  const bodyFontName = pairing?.bodyFont ?? g.typography?.bodyFont;
  const headingFontName = pairing?.headingFont ?? g.typography?.headingFont;
  const accentFontName = pairing?.accentFont ?? g.typography?.accentFont;
  if (bodyFontName) {
    loadGoogleFont(bodyFontName);
    root.style.setProperty("--theme-body-font", `"${bodyFontName}", sans-serif`);
  }
  if (headingFontName) {
    loadGoogleFont(headingFontName);
    root.style.setProperty("--theme-heading-font", `"${headingFontName}", sans-serif`);
  }
  // accentFont had no reader at all until this fix — HeadingTextPreset.font
  // can name "accent" per heading level (see applyHeadingPreset above), and
  // Buttons > Primary's font role (below) can too.
  if (accentFontName) {
    loadGoogleFont(accentFontName);
    root.style.setProperty("--theme-accent-font", `"${accentFontName}", sans-serif`);
  }
  if (g.typography?.paragraph) {
    root.style.setProperty("--text-paragraph-size", `${g.typography.paragraph.size}px`);
    root.style.setProperty("--text-paragraph-line-height", String(resolveLineHeight(g.typography.paragraph.lineHeight)));
  }
  // Phase B1 — typography.baseFontSize overrides the paragraph size when set.
  if (g.typography?.baseFontSize) {
    root.style.setProperty("--text-paragraph-size", `${g.typography.baseFontSize}px`);
  }
  // Phase B1 — typography.scale: overrides ONLY --text-h{n}-size from a
  // per-scale px table; applyHeadingPreset still drives line-height /
  // letter-spacing / transform / font-role from the stored preset (which is
  // never mutated). Unset ⇒ applyHeadingPreset writes preset.size, today's
  // behaviour.
  const scaleSizes = resolveScaleSizes(g.typography?.scale);
  for (const key of HEADING_KEYS) {
    const preset = g.typography?.[key];
    if (preset) applyHeadingPreset(root.style, key, preset);
    if (scaleSizes) root.style.setProperty(`--text-${key}-size`, `${scaleSizes[key]}px`);
  }

  // Buttons — --theme-radius has been read by half a dozen section
  // components (Hero's CTA, Newsletter, FeaturedCollections/ProductGrid/
  // ImageText images, ...) since the visual theme builder shipped, but
  // nothing ever actually called setProperty for it — a real, confirmed
  // gap (grep found only comments referencing it, no write site), not a
  // guess. Sourced from the primary button style since that's what every
  // one of those call sites is really styling.
  if (g.buttons?.primary) {
    // Phase B1 — `buttons.primary.cornerRadius` ALWAYS drives --theme-radius
    // (buttons, the newsletter input, the Featured/ImageText/ProductGrid
    // section image containers) unless the merchant explicitly turns on
    // `radius.applyToButtons`, in which case the radius scale's md value
    // takes over. No seed sentinel. See resolveThemeRadius in lib/radius.ts.
    root.style.setProperty("--theme-radius", resolveThemeRadius(g.radius, g.buttons.primary.cornerRadius));
    root.style.setProperty("--theme-button-border-width", `${g.buttons.primary.borderThickness}px`);
    root.style.setProperty("--theme-button-text-transform", g.buttons.primary.case === "uppercase" ? "uppercase" : "none");
    root.style.setProperty("--theme-button-font", g.buttons.primary.font === "accent" ? "var(--theme-accent-font, inherit)" : "var(--theme-body-font, inherit)");
  }

  // buttons.secondary and buttons.pillCornerRadius have no CSS var here —
  // confirmed via grep, no button anywhere in the theme sections renders a
  // "secondary" or "pill" variant (Hero's CTA and Newsletter's submit are
  // the only two themeButtonBaseStyle() consumers, and both are always
  // primary-styled). Setting vars nothing reads would be dead code; flagged
  // here rather than fabricated, same as the pre-existing transparentOnHero
  // note in ThemeDrivenHeader.tsx.

  // Icons: no CSS var here — lucide's strokeWidth is a numeric SVG prop,
  // not something a CSS custom property can feed into a React component
  // prop. ThemeDrivenHeader.tsx/SearchBar.tsx read
  // themeConfig.globalSettings.icons.stroke directly via useShop() instead
  // (see theme-element-style.ts's resolveIconStrokeWidth).

  // Logo — desktopHeight/mobileHeight had no reader either; ThemeDrivenHeader
  // rendered the logo at a hardcoded height regardless of this setting.
  if (g.logo) {
    root.style.setProperty("--theme-logo-height", `${g.logo.desktopHeight}px`);
    root.style.setProperty("--theme-logo-height-mobile", `${g.logo.mobileHeight}px`);
  }

  // Product card hover — same "hardcoded class instead of the setting"
  // gap as --theme-radius; ProductGridSection previously always applied
  // `group-hover:scale-[1.04]` regardless of this field's value. Resolver +
  // SPA-leak clear live in lib/card-hover.ts (post-G0 batch extraction).
  applyCardHoverCssVars(root.style, g.animations?.cardHoverEffect);

  // productCardTransition gates whether the hover transform above animates
  // or snaps instantly — ProductGridSection previously hardcoded
  // `transition-transform duration-300` on every card image regardless of
  // this boolean, so turning it off in Theme Settings did nothing.
  root.style.setProperty(
    "--theme-card-hover-transition-duration",
    // Phase A — still a hard 0ms when the merchant turns the toggle off;
    // otherwise defer to the motion token (300ms fallback = today).
    g.animations?.productCardTransition === false ? "0ms" : "var(--motion-duration-base, 300ms)",
  );

  // animations.pageTransition and animations.addToCart have no CSS var
  // here — this storefront has no route-transition wrapper and no
  // add-to-cart flying/motion animation anywhere in its codebase for either
  // toggle to gate (confirmed via grep). Building those animation systems
  // from scratch is a new feature, not a wiring fix; flagged rather than
  // fabricated, same reasoning as buttons.secondary/pillCornerRadius above.
}

// Phase A (motion foundation) — writes the --motion-* token table (desktop +
// the sub-640px `-m` mobile tier) from globalSettings.motion, and clears any
// --motion-* prop this theme doesn't define (SPA-leak guard). Runs in the same
// merged [shop, themeConfig] effect as applyThemeConfigOverrides. When `motion`
// is unset / {} / has no known `intensity`, nothing is written — every
// `var(--motion-*, <literal>)` across globals.css + the components then
// resolves to its literal fallback (= today's exact value), so the storefront
// renders byte-identically. The set/clear loop is applyMotionCssVars in
// lib/motion.ts (unit-tested there, incl. the set-then-unset transition).
function applyMotionOverrides(config: ThemeConfig | null) {
  applyMotionCssVars(document.documentElement.style, config?.globalSettings?.motion);
}

// Phase B1 (design-token foundation) — writes the --theme-round-sm/-md/-lg
// scale from globalSettings.radius, and clears any this theme doesn't define
// (SPA-leak guard). `radius` unset / {} / no `preset` ⇒ nothing written ⇒
// every `var(--theme-round-*, <literal>)` in the `.theme-round-*` classes
// resolves to its pre-B1 literal. (The name is --theme-round-*, NOT --radius-*:
// the latter is a Tailwind v4 theme namespace and would move every `rounded-*`
// utility site-wide — B1's original bug, fixed in the follow-up hotfix.)
// `applyToButtons` is NOT handled here — it
// gates the --theme-radius bridge inside applyThemeConfigOverrides. Set/clear
// loop is applyRadiusCssVars in lib/radius.ts (unit-tested, incl. the
// set-then-unset transition).
function applyRadiusOverrides(config: ThemeConfig | null) {
  applyRadiusCssVars(document.documentElement.style, config?.globalSettings?.radius);
}

// Phase B2 (design-token foundation) — writes --section-py / --grid-gap /
// --grid-gap-m / --section-heading-gap from globalSettings.density, and clears
// any this theme doesn't define (SPA-leak guard). `density` unset / {} / no
// `preset` ⇒ nothing written ⇒ every `.theme-section-py` / `.theme-grid-gap` /
// `.theme-heading-gap` class falls back to its pre-B2 Tailwind literal. Set/
// clear loop is applyDensityCssVars in lib/density.ts (unit-tested, incl. the
// set-then-unset transition).
function applyDensityOverrides(config: ThemeConfig | null) {
  applyDensityCssVars(document.documentElement.style, config?.globalSettings?.density);
}

export function ShopProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const shopBasePath = pathname === `/${shopSlug}` || pathname.startsWith(`/${shopSlug}/`) ? `/${shopSlug}` : "";
  const [shop, setShop] = useState<Shop | null>(null);
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [autoDiscounts, setAutoDiscounts] = useState<AutoDiscount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [themeConfig, setThemeConfig] = useState<ThemeConfig | null>(null);

  const urlPreview = searchParams.get("preview") === "true";
  const urlThemeId = searchParams.get("themeId");
  const urlToken = searchParams.get("previewToken") ?? undefined;

  // Bug 3 root cause: every internal <Link> in this app (MenuBar, product/
  // collection cards, search results, ...) is a plain shop-relative path
  // with no query string — none of them carry ?preview=true&themeId=...
  // forward. The admin builder's iframe only ever sets those params on its
  // OWN initial src (PreviewFrame.tsx); the instant a merchant clicks any
  // in-preview link to a collection/product page, that next page's own
  // useSearchParams() sees no preview params at all, previewMode flips to
  // false, and every preview-gated behavior (data-requital-editable
  // attributes, PreviewInteraction's double-click select, the
  // theme-config-update postMessage listener above) turns off for the rest
  // of the session — permanently, since nothing ever re-adds the params.
  // Fixed at the root rather than threading a query string through every
  // Link call site: once a real preview session is observed in the URL,
  // it's persisted to sessionStorage (scoped per shop, same convention as
  // cart.tsx/CookieConsentBanner's own scoped keys) and used as a fallback
  // whenever a later same-tab navigation's URL has no preview params of its
  // own. The URL always wins when it does carry real params (a fresh
  // ?preview=true visit, or the page-switcher below setting a new src).
  const sessionKey = `requital_preview_session:${shopSlug}`;
  const [restoredPreview, setRestoredPreview] = useState<{ themeId: string; token: string | undefined } | null>(null);

  useEffect(() => {
    if (urlPreview && urlThemeId) {
      sessionStorage.setItem(sessionKey, JSON.stringify({ themeId: urlThemeId, token: urlToken ?? null }));
      return;
    }
    try {
      const raw = sessionStorage.getItem(sessionKey);
      if (raw) {
        const parsed = JSON.parse(raw) as { themeId: string; token: string | null };
        setRestoredPreview({ themeId: parsed.themeId, token: parsed.token ?? undefined });
      }
    } catch {
      // malformed/inaccessible sessionStorage - just stay out of preview mode
    }
  }, [sessionKey, urlPreview, urlThemeId, urlToken]);

  const preview = urlPreview || restoredPreview !== null;
  const previewThemeId = urlPreview ? urlThemeId : (restoredPreview?.themeId ?? null);
  const previewToken = urlPreview ? urlToken : restoredPreview?.token;

  // [PREVIEW-DIAG] Logs the exact URL/query params this page saw, and
  // which preview-detection path (real URL params vs sessionStorage
  // fallback) resolved `preview` to true/false — this is the single most
  // direct way to confirm or rule out "the dropdown navigated to a URL
  // that dropped the preview query params."
  useEffect(() => {
    // eslint-disable-next-line no-console
    console.log("[PREVIEW-DIAG] shop-context preview detection", {
      pathname,
      href: typeof window !== "undefined" ? window.location.href : null,
      search: typeof window !== "undefined" ? window.location.search : null,
      urlPreview,
      urlThemeId,
      urlTokenPresent: !!urlToken,
      restoredPreview,
      resolvedPreview: preview,
      resolvedPreviewThemeId: previewThemeId,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, urlPreview, urlThemeId, urlToken, restoredPreview]);

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
    Promise.all([getShop(shopSlug), listOutlets(shopSlug, previewToken)])
      .then(([shopRes, outletsRes]) => {
        setShop(shopRes);
        setOutlets(outletsRes);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load shop"))
      .finally(() => setLoading(false));
  }, [shopSlug, previewToken]);

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

  // Separate fetch from getShop/listOutlets above, same reasoning as
  // themeConfig's own separate effect — a failure here shouldn't surface as
  // a whole-shop error page, just no struck-through pricing anywhere.
  useEffect(() => {
    listActiveAutoDiscounts(shopSlug)
      .then(setAutoDiscounts)
      .catch(() => setAutoDiscounts([]));
  }, [shopSlug]);

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
      if (event.data?.type === "legacy-theme-update" && event.data.legacyTheme) {
        setShop((prev) => (prev ? mergeLegacyThemeIntoShop(prev, event.data.legacyTheme) : prev));
      }
    }
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, [preview]);

  // One effect, both deps: applyTheme (Appearance Colors) and
  // applyThemeConfigOverrides (the published theme's color scheme) both
  // write shared surface vars (--background, --color-header,
  // --color-header-fg, --color-product-name, --color-accent*). Running them
  // in a fixed order in a single effect keyed on BOTH inputs means the
  // scheme always re-applies last — so editing a Layout-mode setting in the
  // builder (which updates `shop` via mergeLegacyThemeIntoShop and would
  // otherwise re-run applyTheme alone) can't leave the scheme's colors
  // clobbered until the next theme-config-update message.
  useEffect(() => {
    applyTheme(shop);
    applyLegacyThemeOverrides(shop);
    applyThemeConfigOverrides(themeConfig);
    applyMotionOverrides(themeConfig);
    applyRadiusOverrides(themeConfig);
    applyDensityOverrides(themeConfig);
  }, [shop, themeConfig]);

  return (
    <ShopContext.Provider
      value={{ shopSlug, shopBasePath, shop, outlets, loading, error, themeConfig, previewMode: preview, previewToken, autoDiscounts }}
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
