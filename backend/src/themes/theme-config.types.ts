// Shape of the `theme.config`/`theme.publishedConfig` JSON blob — the
// visual theme builder's data model (see prisma/migrations/
// 20260812130000_create_theme_table). Mirrored by hand in
// admin/lib/types.ts and storefront/lib/theme-config-types.ts, same
// no-shared-package convention as every other cross-app type in this
// codebase.
//
// REWORK NOTE: this is a from-scratch replacement of the flat PR #31 shape
// (ThemeElement -> ThemeBlock, now recursive; GlobalThemeSettings expanded
// from 8 flat fields to 18 nested categories matching Shopify's real
// Horizon theme settings schema, with a deliberate Dawn-style multi-scheme
// color system layered in per the user's explicit spec). Existing `theme`
// rows predate this shape and are reset, not migrated — see the plan's
// "breaking migration accepted" note.
//
// Header/Footer are global chrome (rendered on every storefront page, not
// just the homepage) — they get their own settings/blocks slots here but
// are deliberately NOT part of `sections[]`, which governs homepage body
// content only.

export type ThemeSectionType =
  | 'announcement_bar'
  | 'hero'
  | 'featured_collections'
  | 'product_grid'
  | 'testimonials'
  | 'rich_text'
  | 'image_text'
  | 'newsletter'
  | 'brands'
  // Tabbed product carousel — pill toggles swap the product set client-side
  // (theme-builder-expansion Phase 2). settings.tabs: { id, label,
  // collectionId }[]; malformed entries are dropped at render, not 400'd
  // (matches the validator's "shallow beyond structure" stance).
  | 'product_tabs'
  // Trust / social-proof strip (Phase 6) — repeatable `trust_item` blocks
  // (icon + short text) + an optional `rating_badge`. Presentational only.
  | 'trust_bar';

export type ScrollAnimation = 'none' | 'fade-in' | 'slide-up' | 'slide-left' | 'slide-right';
// Phase A (motion foundation) — section-entrance vocabulary extension. The
// legacy ScrollAnimation values above stay valid; these are additive. A value
// the storefront doesn't recognise renders as 'none' (no-op).
// Post-G0 batch — 'rotate-in' (needed by Bloom's testimonials; the plan's
// §3.4 #6).
export type SectionEntrance = ScrollAnimation | 'scale-in' | 'blur-in' | 'mask-reveal' | 'rotate-in';
export type SectionVisibility = 'desktop' | 'mobile' | 'both';

// Phase A — the global motion model (docs/plans/theme-templates-and-motion.md
// §2). Nested under GlobalThemeSettings like floatingElements, so
// assertValidThemeConfig's top-level allow-list is untouched; the validator
// treats it as opaque (no per-field schema check). OPTIONAL and inert when
// `intensity` is unset: `applyMotionOverrides` (storefront shop-context.tsx)
// writes nothing, every `var(--motion-*, <literal>)` resolves to its literal
// fallback (= today's exact value), and the storefront renders byte-identical.
// NOTE: `intensity: 'standard'` is a deliberate near-today baseline, NOT
// byte-identical to unset — the only true no-op is `motion` unset / `{}`.
export interface MotionSettings {
  intensity?: 'none' | 'subtle' | 'standard' | 'expressive';
  speed?: number; // 0.5–2.0 multiplier on the duration tokens, default 1
  easing?: 'standard' | 'gentle' | 'snappy' | 'overshoot' | 'linear';
  scrollMotion?: boolean; // master switch for scroll-triggered entrances, default true
  hoverMotion?: boolean; // master switch for hover micro-interactions, default true
  smoothScroll?: boolean; // scroll-behavior: smooth on <html>, default false
  // Declared for a stable shape; no consumer until Phase E/F — the admin
  // Motion panel does not expose these yet.
  scrollProgressBar?: boolean;
  snapSections?: boolean;
  decorativeParallax?: boolean;
  customCursor?: boolean;
}

// Phase A — per-section motion override, carried on the free-form
// SectionSettings bag. Absent ⇒ resolveSectionMotion falls back to
// `scrollAnimation` (or 'none'), stagger off, animateOnce on, trigger 'scroll'
// — the exact pre-Phase-A behaviour.
export interface SectionMotionSettings {
  entrance?: SectionEntrance;
  stagger?: boolean; // per-child stagger — type + CSS plumbing only in Phase A, no exposed control
  animateOnce?: boolean; // default true; false = re-animate on every scroll-in
  trigger?: 'scroll' | 'load';
}

// A block within a section (or Header/Footer) — the real Shopify-style
// content-piece-inside-a-container model, replacing PR #31's flat
// `ThemeElement`. Self-referential `blocks` supports sub-blocks (e.g.
// Featured Collections' "Product card" block containing Media/Title/Price
// sub-blocks) — depth-capped at 4 in theme-config.validation.ts (real
// Shopify allows 8 for app-extensible theme blocks; our fixed,
// non-app-extensible catalog doesn't need that depth).
export interface ThemeBlock {
  id: string;
  type: string;
  visible: boolean;
  order: number;
  settings: Record<string, unknown>;
  blocks?: ThemeBlock[];
}

// Every section's shared controls (typography/spacing/background/
// scrollAnimation/visibility) plus whatever section-specific fields that
// type needs — deliberately not typed per-field beyond the shared ones,
// since section-specific settings vary by `type` and are only
// deep-validated client-side. `schemeId` is new: an optional reference to a
// GlobalThemeSettings.colorSchemes[].id — when set, the storefront resolves
// colors from the named scheme; `background` stays as the custom-override
// escape hatch when no scheme is chosen (or to override on top of one).
export interface SectionSettings {
  typography?: Record<string, unknown>;
  spacing?: { top?: number; bottom?: number; left?: number; right?: number };
  background?: Record<string, unknown>;
  schemeId?: string;
  scrollAnimation?: ScrollAnimation;
  // Phase A — new-style per-section motion; wins over `scrollAnimation` when set.
  motion?: SectionMotionSettings;
  // Phase B1 — per-section product-card image aspect; wins over
  // globalSettings.productCards.imageAspect for a product_grid / product_tabs
  // section. Unset ⇒ the global (or `square`).
  imageAspect?: ImageAspect;
  visibility?: SectionVisibility;
  [key: string]: unknown;
}

export interface ThemeSection {
  id: string;
  type: ThemeSectionType;
  visible: boolean;
  order: number;
  settings: SectionSettings;
  blocks: ThemeBlock[];
}

// Global chrome (Header/Footer) — same block-tree shape as a section, but a
// fixed named slot rather than a sections[] array member (not reorderable
// relative to page content; see the scope decision).
// theme-builder-expansion Phase 3 (decision TBE1): an OPTIONAL grouping laid
// over the existing flat `blocks[]` — it does not restructure anything. A
// row lists block ids (in render order) that should appear on their own
// horizontal bar. `header.settings.rows` absent ⇒ the storefront renders the
// pre-existing single 3-zone grid, byte-for-byte. Blocks not referenced by
// any row fall into the last row so nothing is ever dropped. Stored on
// `settings`, which is already free-form `Record<string, unknown>` — no
// structural / migration impact.
export interface HeaderRow {
  id: string;
  blockIds: string[];
  align?: 'left' | 'center' | 'right' | 'between';
  background?: string;
}

// C2 — `header.settings.mobileNav`, default (absent/'scroll') is today's
// only behaviour: MenuBar.tsx's horizontal-scroll pill row at every
// viewport width, completely untouched. The other three modes are rendered
// by the new storefront/components/MobileNav.tsx, mounted independently of
// MenuBar (see that file's own header comment for why).
export type MobileNavMode = 'scroll' | 'drawer' | 'bottom-bar' | 'fullscreen';

// theme-builder-expansion Phase 5 (decision TBE3): the PERSISTENT chrome
// announcement bar — distinct from the homepage-body `announcement_bar`
// section (which is untouched). Stored at `header.settings.announcementBar`
// (free-form settings bag, no structural impact). Absent / `enabled: false`
// ⇒ the storefront falls back to the legacy `shop.announcementBarEnabled` /
// `shop.notificationText` bar, unchanged.
export interface AnnouncementBarConfig {
  enabled: boolean;
  messages: string[];
  scrolling?: boolean;
  speed?: 'fast' | 'medium' | 'slow';
  dismissible?: boolean;
  background?: string;
  textColor?: string;
}

export interface HeaderFooterConfig {
  settings: Record<string, unknown>;
  blocks: ThemeBlock[];
}

// --- Theme Settings: 18 categories, matching Shopify Horizon's real
// settings_schema.json structure (verified against Shopify/horizon), with
// a deliberate Dawn-style (Shopify/dawn) multi-scheme color system layered
// in per the user's explicit spec — Horizon itself only has a single
// color_palette, not reusable named schemes with an "Edit scheme" jump-link
// UX. See the plan's "Scope decisions" section for the full reasoning. ---

export interface LogoSettings {
  defaultLogoUrl?: string;
  inverseLogoUrl?: string;
  desktopHeight: number;
  mobileHeight: number;
  faviconUrl?: string;
}

// A reusable named color set, referenced by id from section settings and
// from Badges/Drawers/Popovers below (Dawn's color_scheme_group model).
export interface ColorScheme {
  id: string;
  name: string;
  background: string;
  backgroundGradient?: string;
  text: string;
  button: string;
  buttonLabel: string;
  secondaryButtonLabel: string;
  border?: string;
  shadow?: string;
}

export type TextLineHeight = 'tight' | 'normal' | 'loose';
export type TextLetterSpacing = 'tight' | 'normal' | 'wide';
export type TextCase = 'default' | 'uppercase';
export type FontRole = 'heading' | 'accent';

// Paragraph only gets size + line height (no font-role/letter-spacing/case)
// — matches Horizon's real schema exactly (confirmed: Paragraph has fewer
// controls than H1-H6 there).
export interface ParagraphTextPreset {
  size: number;
  lineHeight: TextLineHeight;
}

export interface HeadingTextPreset {
  font: FontRole;
  size: number;
  lineHeight: TextLineHeight;
  letterSpacing: TextLetterSpacing;
  case: TextCase;
}

export interface TypographySettings {
  bodyFont: string;
  subheadingFont: string;
  headingFont: string;
  accentFont: string;
  paragraph: ParagraphTextPreset;
  h1: HeadingTextPreset;
  h2: HeadingTextPreset;
  h3: HeadingTextPreset;
  h4: HeadingTextPreset;
  h5: HeadingTextPreset;
  h6: HeadingTextPreset;
  // Phase B1 — optional. See TypographyPairing / TypeScale above.
  pairing?: TypographyPairing;
  scale?: TypeScale;
  baseFontSize?: 14 | 15 | 16 | 17;
}

export interface PageLayoutSettings {
  width: 'narrow' | 'normal' | 'wide';
}

// Phase B1 (design-token foundation) — one radius language. `preset` unset ⇒
// inert (resolveRadiusCssVars → {}), every `var(--radius-*, <literal>)` resolves
// to today's Tailwind value ⇒ byte-identical. `applyToButtons` is an EXPLICIT
// opt-in: `buttons.primary.cornerRadius` always drives `--theme-radius` (buttons,
// the newsletter input, the section image containers) unless the merchant turns
// this on — no "seed default == untouched" guess. See
// storefront/lib/radius.ts + shop-context.tsx's `--theme-radius` line.
export type RadiusPreset = 'sharp' | 'subtle' | 'rounded' | 'soft' | 'pill';
export interface RadiusSettings {
  preset?: RadiusPreset;
  applyToButtons?: boolean;
}

// Phase B2 (design-token foundation) — one density lever. `preset` unset ⇒ inert
// (resolveDensityCssVars → {}); every `.theme-section-py` / `.theme-grid-gap` /
// `.theme-heading-gap` class in globals.css falls back to its pre-B2 Tailwind
// literal ⇒ byte-identical. Object wrapper (not a bare enum) so
// updateGlobalSettingsCategory can write it and DEFAULT_THEME_CONFIG can seed
// `{}` inertly — same convention as `motion` / `radius`. See
// storefront/lib/density.ts.
export type DensityPreset = 'compact' | 'cozy' | 'comfortable' | 'spacious';
export interface DensitySettings {
  preset?: DensityPreset;
}

// Phase B1 — shared card-shape enums (mirrored in admin/storefront).
export type CardStyle =
  | 'minimal'
  | 'bordered'
  | 'shadowed'
  | 'elevated'
  | 'outlined-hover'
  | 'filled'
  | 'polaroid'
  | 'overlay';
export type ImageAspect = 'square' | 'portrait' | 'landscape' | 'tall';

// Phase B1 — typography pairing + modular scale. Both OPTIONAL keys on the
// EXISTING TypographySettings. `pairing` unset ⇒ the per-role bodyFont/etc.
// reads run as today. `scale` unset ⇒ the explicit h1–h6 `.size` values win
// (today's behaviour); when set it overrides ONLY `--text-h{n}-size` from a
// per-scale px table, the stored sizes are untouched.
export type TypographyPairing =
  | 'modern-sans'
  | 'editorial-serif'
  | 'warm-humanist'
  | 'grotesque'
  | 'classic'
  | 'bold-display'
  | 'handwritten-accent';
export type TypeScale = 'compact' | 'default' | 'spacious' | 'dramatic';

export interface AnimationSettings {
  pageTransition: boolean;
  productCardTransition: boolean;
  addToCart: boolean;
  // 'zoom' scales the image (matches --theme-card-hover-transform in
  // shop-context.tsx); 'rise' translates+shadows the card itself instead
  // (--theme-card-hover-card-transform); 'swap' shows the product's second
  // image on hover (no CSS transform at all — see
  // use-product-card-image-index.ts). storefront-v2 Phase 2E renamed this
  // from 'lift'/'scale' to 'rise'/'zoom' and added 'swap'.
  // Post-G0 batch — 'desaturate' (grayscale-ish -> colour on hover, image
  // filter), 'quick-add-slide' (the quick-add button slides up + fades in
  // instead of instant show/hide), 'overlay' (a scheme-tinted wash fades over
  // the image), 'shadow' (box-shadow grows, card static, no transform), 'tilt'
  // (a fixed-angle CSS-only rotate, no cursor tracking — the S version from
  // the plan's §3.1 #10).
  cardHoverEffect: 'none' | 'zoom' | 'rise' | 'swap' | 'desaturate' | 'quick-add-slide' | 'overlay' | 'shadow' | 'tilt';
  // Post-G0 batch — skeleton -> image crossfade on load, replacing the bare
  // bg-black/5 placeholder. Unset ⇒ today (no fade, image just pops in once
  // decoded). 'blur-up' needs a stored tiny preview per upload (no resize
  // endpoint exists today) — deliberately not built; only 'fade' ships.
  imageLoad?: 'none' | 'fade';
}

export interface BadgeSettings {
  position: 'top_right' | 'top_left' | 'bottom_right' | 'bottom_left';
  cornerRadius: number;
  saleSchemeId: string;
  soldOutSchemeId: string;
  font: 'body' | 'accent';
  case: TextCase;
}

// hoverEffect/pressEffect (§8.7 item 1, 2026-09-05) — OPTIONAL, no
// DEFAULT_THEME_CONFIG value, so absent ⇒ today's exact button render.
// Shared by .primary and .secondary even though only .primary has a real
// render path today (Hero CTA, Newsletter submit) — .secondary renders
// nowhere yet, so these fields simply sit unused there until a future phase
// gives it one (see §9.3's dead-control table).
export type ButtonHoverEffect = 'none' | 'sweep' | 'shine' | 'border-fill' | 'icon-nudge';

export interface ButtonStyleSettings {
  borderThickness: number;
  cornerRadius: number;
  font: 'body' | 'accent';
  case: TextCase;
  hoverEffect?: ButtonHoverEffect;
  pressEffect?: boolean;
}

export interface ButtonSettings {
  primary: ButtonStyleSettings;
  secondary: ButtonStyleSettings;
  pillCornerRadius: number;
}

export interface CartSettings {
  allowNote: boolean;
  allowDiscounts: boolean;
  installments: boolean;
  acceleratedCheckout: boolean;
  emptyCartLink?: string;
  mediaBorderStyle: 'none' | 'solid';
  mediaCornerRadius: number;
}

export interface DrawerSettings {
  schemeId: string;
  bordersStyle: 'none' | 'solid';
  dropShadow: boolean;
}

export interface IconSettings {
  stroke: 'thin' | 'default' | 'heavy';
}

export interface InputFieldSettings {
  borderThickness: number;
  cornerRadius: number;
  textPreset: string;
}

export interface PopoverSettings {
  schemeId: string;
  cornerRadius: number;
  borders: 'none' | 'solid';
  dropShadow: boolean;
}

export interface PriceSettings {
  currencyCode: {
    productPages: boolean;
    productCards: boolean;
    cartItems: boolean;
    cartTotal: boolean;
  };
  // Phase B1 — the discounted price colour on ProductCard.tsx's PriceDisplay
  // (replaces the hardcoded `text-red-600`). Unset ⇒ `--color-sale-price`
  // stays #dc2626 (= red-600). `strikethrough-only` drops the colour entirely
  // (only the struck original marks the discount). No `badge` — the
  // globalSettings.badges Sale chip already covers that.
  salePriceColor?: string;
  salePriceStyle?: 'color' | 'strikethrough-only';
}

// Quick-add colors are two plain color settings, not a scheme reference —
// verified against Horizon's real schema (quick_add_background/
// quick_add_text are discrete `color` settings, not a color_scheme picker).
//
// The hover *effect itself* (zoom/rise/swap/none) is
// animations.cardHoverEffect, not a field here — it already existed
// (AnimationSettings, above) before storefront-v2, just under-specified
// ('lift'/'scale' renamed to 'rise'/'zoom', 'swap' added) and not fully
// wired storefront-side (see ProductCard.tsx). showSecondImageOnHover (dead
// code — never actually consumed by any storefront component) is dropped
// entirely rather than kept alongside the renamed cardHoverEffect, since
// they described the same concept twice.
export interface ProductCardSettings {
  quickAdd: boolean;
  mobileQuickAdd: boolean;
  quickAddBackground: string;
  quickAddText: string;
  showCarousel: boolean;
  productNameFontSize: number;
  productNameFontWeight: 'regular' | 'medium' | 'bold';
  productNameColor: string;
  // Default off - matches the cleaner-look default the grid already shipped
  // with (a short excerpt under every card), a merchant opts in explicitly.
  showProductDescriptions: boolean;
  // Optional (older published themes lack it) — gates the entire wishlist
  // feature storefront-side: the heart on product cards, the account nav
  // tile, and the /account/wishlist page. Absent/false ⇒ no wishlist UI at
  // all. Mirrored in admin/lib/types.ts + storefront/lib/theme-config-types.ts.
  showWishlist?: boolean;
  // Phase B1 — all optional. `cardStyle` here is the DEFAULT for the
  // standalone collection-page ProductCard + a fallback for
  // product_grid/product_tabs sections (the section's own
  // settings.cardStyle still wins). `imageAspect` / `textAlign` / `density`
  // apply to every product card storefront-wide. Unset ⇒ today
  // (minimal / aspect-square / left / comfortable).
  cardStyle?: CardStyle;
  imageAspect?: ImageAspect;
  textAlign?: 'left' | 'center';
  density?: 'comfortable' | 'compact';
}

// storefront-v2 Phase 2C/2D — settings for the standalone collection
// (taxonomy node) detail page, /[shop]/collections/[slug]. Not part of the
// section-based homepage system (that page isn't composed of theme
// sections), so it gets its own small global category instead of living on
// a per-instance section's settings the way the ticket originally
// sketched it.
export interface CollectionPageSettings {
  textAboveProducts: string;
  textBelowProducts: string;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  loadMoreStyle: 'infinite' | 'pagination';
  // Bug 6 fix: was a customer-facing 2/3/4-column icon selector on the live
  // storefront collection page - a merchant-only layout choice mistakenly
  // exposed to shoppers. Now a fixed default the merchant sets here; the
  // storefront no longer offers any way to change it.
  columns: 2 | 3 | 4 | 5 | 6;
  // Undefined/null = automatic (desktopColumns <= 2 ? 1 : 2) - the grid
  // used to hardcode a single mobile column regardless of this setting;
  // this lets a merchant override that mapping explicitly.
  mobileColumns?: 1 | 2;
}

// Governs the PDP's stock/delivery/pickup status line
// (storefront/app/[shop]/products/[slug]/ProductDetailClient.tsx) — same
// reasoning as CollectionPageSettings just above: the product page isn't
// composed of theme sections either, so this is its own small global
// category rather than a per-section settings blob. The three show* toggles
// only ever hide an indicator whose underlying condition was already false
// on real data (out-of-stock/no delivery outlet/no pickup outlet) or already
// true (in stock/delivery available/pickup available) - there is no
// merchant-editable text for these, only whether the real, live value is
// shown and what color it renders in.
export interface ProductPageSettings {
  showStockIndicator: boolean;
  showDeliveryIndicator: boolean;
  showPickupIndicator: boolean;
  // The "Buy Now Pay Later!" card (Tabby/Tamara installment-promo widgets)
  // under the price. The card only renders at all when at least one of those
  // providers is enabled + has a public key; this lets a merchant hide it
  // even then. Default true.
  showBnplWidget: boolean;
  inStockColor: string;
  lowStockColor: string;
  outOfStockColor: string;
  fulfillmentTextColor: string;
}

export interface SearchSettings {
  emptyStateCollectionId?: number;
  productCornerRadius: number;
  cardCornerRadius: number;
  titleCase: TextCase;
}

export interface SwatchSettings {
  variantImages: boolean;
  width: number;
  height: number;
  cornerRadius: number;
  borders: 'none' | 'solid';
  borderThickness: number;
  borderOpacity: number;
}

export interface VariantPickerSettings {
  borderThickness: number;
  cornerRadius: number;
  width: 'fit' | 'fill';
}

// Real functionality, not a placeholder — injected as a raw <style> tag on
// the storefront when published. Server-validated (length cap + reject
// list) in theme-config.validation.ts, matching Shopify's own real
// theme-level Custom CSS limits (1500 chars, no @import/@charset/@namespace).
export interface CustomCssSettings {
  css: string;
}

// theme-builder-expansion Phase 6 (TBE7): persistent overlay elements —
// floating WhatsApp + custom link buttons (a rewards/chat launcher is just a
// link-out; no embedded third-party scripts). Nested under globalSettings
// specifically so it does NOT touch assertValidThemeConfig's top-level
// allow-list. OPTIONAL — an existing published theme won't have the key;
// every consumer guards with `?.`.
export type FloatingPosition = 'bottom_right' | 'bottom_left';
export interface FloatingCustomButton {
  id: string;
  label: string;
  url: string;
  iconUrl?: string;
  position?: FloatingPosition;
}
export interface FloatingElementsSettings {
  whatsapp: { enabled: boolean; position?: FloatingPosition };
  customButtons: FloatingCustomButton[];
  // C1/C2 batch — closes out floatingElements.backToTop from Phase F's
  // remaining scope (built now, not later). OPTIONAL; absent/enabled:false
  // ⇒ BackToTopButton never renders. Fixed bottom-left position (opposite
  // WhatsApp's default bottom-right) — no position field, unlike whatsapp/
  // customButtons, since there's only ever one back-to-top button.
  backToTop?: { enabled?: boolean };
}

export interface GlobalThemeSettings {
  logo: LogoSettings;
  colorSchemes: ColorScheme[];
  typography: TypographySettings;
  pageLayout: PageLayoutSettings;
  // Phase B1 — the radius scale. OPTIONAL; DEFAULT_THEME_CONFIG seeds `{}`
  // (inert). See RadiusSettings above.
  radius?: RadiusSettings;
  // Phase B2 — the density scale. OPTIONAL; DEFAULT_THEME_CONFIG seeds `{}`
  // (inert). See DensitySettings above.
  density?: DensitySettings;
  animations: AnimationSettings;
  // Phase A — the global motion model. OPTIONAL; DEFAULT_THEME_CONFIG seeds
  // `{}` (inert). See MotionSettings above.
  motion?: MotionSettings;
  badges: BadgeSettings;
  buttons: ButtonSettings;
  cart: CartSettings;
  drawers: DrawerSettings;
  icons: IconSettings;
  inputFields: InputFieldSettings;
  popovers: PopoverSettings;
  prices: PriceSettings;
  productCards: ProductCardSettings;
  search: SearchSettings;
  swatches: SwatchSettings;
  variantPickers: VariantPickerSettings;
  customCss: CustomCssSettings;
  collectionPage: CollectionPageSettings;
  productPage: ProductPageSettings;
  // Phase 6 — optional (older published themes lack it; DEFAULT_THEME_CONFIG
  // seeds a no-op default for new ones).
  floatingElements?: FloatingElementsSettings;
}

export interface ThemeConfig {
  globalSettings: GlobalThemeSettings;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  sections: ThemeSection[];
}
