// Curated list, not arbitrary font upload/free text — matches the task
// brief. Each value is also the Google Fonts family name the storefront's
// root layout preloads via next/font/google — keep the two in sync by hand.
export const FONT_CHOICES = ['inter', 'poppins', 'playfair-display', 'roboto'] as const;
export type FontChoice = (typeof FONT_CHOICES)[number];

// Advanced tab — a fixed set of pre-built homepage layouts, not a
// merchant-composable section builder (that's the deferred full
// drag-and-drop option). 'custom' is reserved for that future builder to
// slot into as a fourth option later without a schema change — it's part
// of the type/DB enum now but deliberately NOT in SELECTABLE_HOMEPAGE_LAYOUTS,
// so nothing can select it yet and the storefront's switch needs a safe
// fallback for it regardless (see storefront app/[shop]/page.tsx).
// 'grid_first' added for Theme Customizer v2 (Baymard/2026-homepage-research
// task) — products immediately, minimal hero. Slots in as a normal
// selectable layout alongside the three that already existed; 'custom'
// remains reserved/unselectable for the still-deferred drag-and-drop builder.
export const HOMEPAGE_LAYOUTS = ['classic', 'slideshow', 'featured_grid', 'grid_first', 'custom'] as const;
export type HomepageLayout = (typeof HOMEPAGE_LAYOUTS)[number];
export const SELECTABLE_HOMEPAGE_LAYOUTS = ['classic', 'slideshow', 'featured_grid', 'grid_first'] as const;

// Granular color palette (Appearance Color tab) — stored as one themesettings.colors
// JSON blob (Record<key, hex>) rather than ~22 individual columns, since these are
// all optional per-shop hex overrides with no query/filter need of their own — a
// JSON blob keeps this from being 22 migrations for 22 leaf values. `group` is
// purely for the admin UI's three-card layout, matching the reference's own
// grouping. Mirrored by hand in admin/lib/types.ts and storefront/lib/theme-colors.ts
// (no shared package between the three apps — same tradeoff as FONT_CHOICES/
// color-contrast.ts elsewhere in this codebase).
//
// `wired` records whether this color is actually consumed by a real storefront
// element (see storefront/lib/theme-colors.ts and shop-context.tsx) or is
// currently saved-but-cosmetically-inert because no corresponding UI exists yet.
// Flagged rather than building a section just to consume a color — see the
// task's own scope note. Kept here (not just in a comment) so admin can show
// an honest "not yet used on your storefront" hint per field instead of
// silently. footerBackgroundColor/footerTextColor and
// productCarouselBackgroundColor were removed entirely (storefront layout/
// dead-settings pass) rather than left unwired — no footer and no product
// carousel existed on the storefront at the time (RelatedProducts is a
// plain grid), so there was no honest partial state to flag. footerBackgroundColor/
// footerTextColor are back (see below) now that components/Footer.tsx is a
// real element — productCarouselBackgroundColor is still genuinely removed,
// RelatedProducts is still a plain grid. Every other field that was ever
// unwired has since been wired to a real element as the corresponding
// storefront section got built (Featured Grid, Slideshow, and — most
// recently — PDP's compare-at price, FeaturedGrid's tile label, CategoryNav's
// mobile scroll arrows, and ClassicHero's fallback background).
export const THEME_COLOR_GROUPS = [
  { key: 'ui_button_colors', label: 'UI/Button Colors' },
  { key: 'background_header_colors', label: 'Background/Header Colors' },
  { key: 'product_category_colors', label: 'Product/Category Colors' },
] as const;
export type ThemeColorGroup = (typeof THEME_COLOR_GROUPS)[number]['key'];

export interface ThemeColorFieldDef {
  key: string;
  label: string;
  group: ThemeColorGroup;
  wired: boolean;
}

export const THEME_COLOR_FIELDS: ThemeColorFieldDef[] = [
  // --- UI/Button Colors ---
  { key: 'mouseOverColor', label: 'Mouse Over Color', group: 'ui_button_colors', wired: true },
  { key: 'mouseSelectionColor', label: 'Mouse Selection Color', group: 'ui_button_colors', wired: true },
  { key: 'buttonColor', label: 'Button Color', group: 'ui_button_colors', wired: true },
  { key: 'addToCartTextColor', label: 'Add to Cart Text', group: 'ui_button_colors', wired: true },
  { key: 'addToCartButtonColor', label: 'Add to Cart Button Color', group: 'ui_button_colors', wired: true },
  { key: 'strokeColor', label: 'Stroke Color', group: 'ui_button_colors', wired: true },
  // --- Background/Header Colors ---
  { key: 'homepageInfoBackgroundColor', label: 'Homepage Info Background Color', group: 'background_header_colors', wired: true },
  // Wired for the storefront dark-mode-mismatch bug fix — the page canvas
  // previously had no merchant-facing color source at all, just a hardcoded
  // light default an unconditional OS prefers-color-scheme media query
  // silently overrode to near-black. See storefront/lib/theme-colors.ts and
  // globals.css.
  { key: 'pageBackgroundColor', label: 'Page Background Color', group: 'background_header_colors', wired: true },
  { key: 'headerBackgroundColor', label: 'Header Background Color', group: 'background_header_colors', wired: true },
  { key: 'headerTextColor', label: 'Header Text Color', group: 'background_header_colors', wired: true },
  // Re-added (see the removal note above) now that a real footer exists —
  // components/Footer.tsx. Not merged into headerBackgroundColor/
  // headerTextColor: a footer is conventionally a different (often darker)
  // tone than the header, so this needs its own pair, not a shared one.
  { key: 'footerBackgroundColor', label: 'Footer Background Color', group: 'background_header_colors', wired: true },
  { key: 'footerTextColor', label: 'Footer Text Color', group: 'background_header_colors', wired: true },
  // Wired as of the Advanced/homepageLayout task — the "Featured Grid"
  // layout's category-tile section background. Was inert (no Featured
  // section existed) before that layout was built.
  { key: 'featuredBackgroundColor', label: 'Featured Background Color', group: 'background_header_colors', wired: true },
  // --- Product/Category Colors ---
  { key: 'productNameColor', label: 'Product Name Color', group: 'product_category_colors', wired: true },
  { key: 'priceMainColor', label: 'Price Main Color', group: 'product_category_colors', wired: true },
  // Wired for the storefront layout/dead-settings pass — PDP's compare-at-
  // price line, CategoryNav's mobile scroll-nudge arrows, and FeaturedGrid's
  // tile label respectively. See storefront/lib/theme-colors.ts.
  { key: 'priceSecondaryColor', label: 'Price Secondary Color', group: 'product_category_colors', wired: true },
  { key: 'categorySliderArrowColor', label: 'Category Slider Arrow Color (mobile view)', group: 'product_category_colors', wired: true },
  { key: 'categorySliderArrowActiveColor', label: 'Category Slider Arrow Active Color (mobile view)', group: 'product_category_colors', wired: true },
  { key: 'featuredProductTextColor', label: 'Featured Product Text Color', group: 'product_category_colors', wired: true },
  { key: 'brandBackgroundColor', label: 'Brand Background Color', group: 'product_category_colors', wired: true },
  // Wired as of the Advanced/homepageLayout task — the "Slideshow" layout's
  // dot-indicator chrome. Was inert (no slider existed) before that layout
  // was built.
  { key: 'homeSliderBackgroundColor', label: 'Home Slider Background Color', group: 'product_category_colors', wired: true },
  { key: 'homeSliderColor', label: 'Home Slider Color', group: 'product_category_colors', wired: true },
];

export const THEME_COLOR_KEYS = THEME_COLOR_FIELDS.map((f) => f.key);

// Theme Customizer v2 — curated per-page-type layout presets plus global
// icon/button chrome. Each is a small closed enum on themesettings (see
// schema.prisma), same "fixed set Requital maintains, not a section
// builder" shape as HOMEPAGE_LAYOUTS above — every list here IS its own
// selectable set (no 'custom'/reserved-but-unselectable split like homepage
// layout has, since there's no deferred builder for these yet).
export const TOP_BAR_LAYOUTS = ['logo_left', 'logo_center', 'minimal'] as const;
export type TopBarLayout = (typeof TOP_BAR_LAYOUTS)[number];

export const ICON_STYLES = ['outline', 'solid'] as const;
export type IconStyle = (typeof ICON_STYLES)[number];

export const BUTTON_RADII = ['sharp', 'rounded', 'pill'] as const;
export type ButtonRadius = (typeof BUTTON_RADII)[number];

export const BUTTON_FILLS = ['solid', 'outline'] as const;
export type ButtonFill = (typeof BUTTON_FILLS)[number];

export const PDP_LAYOUTS = ['gallery_left', 'gallery_top'] as const;
export type PdpLayout = (typeof PDP_LAYOUTS)[number];

export const CART_LAYOUTS = ['full_page', 'drawer'] as const;
export type CartLayout = (typeof CART_LAYOUTS)[number];

export const CHECKOUT_LAYOUTS = ['single_page', 'step_by_step'] as const;
export type CheckoutLayout = (typeof CHECKOUT_LAYOUTS)[number];

// Footer's structural arrangement — see schema.prisma's comment on
// themesettings.footerLayout.
export const FOOTER_LAYOUTS = ['columns', 'centered'] as const;
export type FooterLayout = (typeof FOOTER_LAYOUTS)[number];

// Header/footer height density — independent of topBarLayout/footerLayout's
// arrangement (any arrangement can pair with any density). Shared list
// between the two (same three sizes), but headerDensity/footerDensity are
// separate columns so a merchant can size them independently.
export const DENSITY_OPTIONS = ['compact', 'regular', 'spacious'] as const;
export type Density = (typeof DENSITY_OPTIONS)[number];
