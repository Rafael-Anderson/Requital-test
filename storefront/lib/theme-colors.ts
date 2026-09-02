// Mirrors backend/src/theme/constants.ts's THEME_COLOR_FIELDS by hand (no
// shared package between admin/backend/storefront). Only the `cssVar` for
// wired:true fields is actually applied to the DOM — see
// shop-context.tsx's applyTheme(). featuredBackgroundColor and
// homeSliderBackgroundColor/homeSliderColor were wired for the Advanced/
// homepageLayout task's real Featured Grid and Slideshow layout components
// (see components/home-layouts/). priceSecondaryColor,
// featuredProductTextColor, collectionSliderArrowColor/ActiveColor, and
// brandBackgroundColor were wired for the storefront layout/dead-settings
// pass — see PDP's compare-at-price line, FeaturedGrid's tile label,
// CollectionNav's mobile scroll arrows, and ClassicHero's fallback background
// respectively (brandBackgroundColor is read directly from shop.colors
// there rather than through the generic applyTheme() loop, so its own
// existing computed default — an accent tint, not a flat color — stays
// exactly as-is for every shop that hasn't explicitly set it).
// footerBackgroundColor/footerTextColor and productCarouselBackgroundColor
// were removed entirely (not just left unwired) — no footer and no product
// carousel exist on the storefront at all (RelatedProducts is a plain
// grid), so there was no honest "not yet visible" middle ground; building
// either is real new-feature scope, flagged rather than done here. See
// admin/lib/types.ts and backend/src/theme/constants.ts, which mirror this
// same removal.
// pageBackgroundColor is new (storefront dark-mode-mismatch bug fix) — the
// page canvas previously had no merchant-facing source at all, just a
// hardcoded light default that an unconditional OS prefers-color-scheme
// media query silently overrode to near-black, independent of every other
// (merchant-controlled, never OS-driven) color on the page. cssVar is
// `--background` itself, not a new `--color-*` token — see globals.css.
export interface ThemeColorFieldDef {
  key: string;
  cssVar: string;
  default: string;
  wired: boolean;
}

export const THEME_COLOR_FIELDS: ThemeColorFieldDef[] = [
  // Default is the CSS keyword `currentColor`, NOT a fixed hue: this drives
  // hover-pill tints (hover:bg-mouse-over/10 in MenuBar/TopBar/SearchBar/
  // CollectionNav/...), and a fixed color (it used to be Requital's teal
  // #057a7a) leaked the admin accent onto every merchant's storefront and was
  // invisible on dark navs. `currentColor` resolves to the hovered element's
  // own text color, so the tint is derived from the merchant's nav colors in
  // both directions (A3 fix). An explicit merchant hex still overrides it.
  { key: "mouseOverColor", cssVar: "--color-mouse-over", default: "currentColor", wired: true },
  { key: "mouseSelectionColor", cssVar: "--color-selection", default: "#b2e0e0", wired: true },
  { key: "buttonColor", cssVar: "--color-button", default: "#069494", wired: true },
  { key: "addToCartTextColor", cssVar: "--color-add-to-cart-text", default: "#ffffff", wired: true },
  { key: "addToCartButtonColor", cssVar: "--color-add-to-cart-button", default: "#069494", wired: true },
  { key: "strokeColor", cssVar: "--color-stroke", default: "#e4e4e7", wired: true },
  { key: "homepageInfoBackgroundColor", cssVar: "--color-homepage-info", default: "#ffffff", wired: true },
  { key: "pageBackgroundColor", cssVar: "--background", default: "#ffffff", wired: true },
  { key: "headerBackgroundColor", cssVar: "--color-header", default: "#ffffff", wired: true },
  { key: "headerTextColor", cssVar: "--color-header-fg", default: "#171717", wired: true },
  // Re-wired (see this file's header comment) now that components/Footer.tsx
  // is a real element — defaults are dark-on-light (a dark footer is the
  // common convention this shape of footer uses), unlike every other pair
  // here which defaults to the page's own light scheme.
  { key: "footerBackgroundColor", cssVar: "--color-footer-bg", default: "#18181b", wired: true },
  { key: "footerTextColor", cssVar: "--color-footer-fg", default: "#f4f4f5", wired: true },
  { key: "featuredBackgroundColor", cssVar: "--color-featured-bg", default: "#f4f4f5", wired: true },
  { key: "productNameColor", cssVar: "--color-product-name", default: "#171717", wired: true },
  { key: "priceMainColor", cssVar: "--color-price-main", default: "#71717a", wired: true },
  { key: "priceSecondaryColor", cssVar: "--color-price-secondary", default: "#a1a1aa", wired: true },
  { key: "collectionSliderArrowColor", cssVar: "--color-collection-arrow", default: "#069494", wired: true },
  { key: "collectionSliderArrowActiveColor", cssVar: "--color-collection-arrow-active", default: "#057a7a", wired: true },
  { key: "featuredProductTextColor", cssVar: "--color-featured-fg", default: "#171717", wired: true },
  { key: "brandBackgroundColor", cssVar: "--color-brand-bg", default: "#f4f4f5", wired: true },
  { key: "homeSliderBackgroundColor", cssVar: "--color-slider-bg", default: "#f4f4f5", wired: true },
  { key: "homeSliderColor", cssVar: "--color-slider-fg", default: "#171717", wired: true },
];

export const WIRED_THEME_COLOR_FIELDS = THEME_COLOR_FIELDS.filter((f) => f.wired);
