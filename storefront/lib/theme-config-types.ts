// Mirrors backend/src/themes/theme-config.types.ts and admin/lib/types.ts by
// hand — same no-shared-package convention as every other cross-app type in
// this codebase.
//
// REWORK NOTE: from-scratch replacement of the flat PR #31 shape
// (ThemeElement -> ThemeBlock, now recursive; GlobalThemeSettings expanded
// from 8 flat fields to 18 nested categories). See backend's own file for
// the full Shopify-research reasoning behind this shape.

export type ThemeSectionType =
  | "announcement_bar"
  | "hero"
  | "featured_collections"
  | "product_grid"
  | "testimonials"
  | "rich_text"
  | "image_text"
  | "newsletter";

export type ScrollAnimation = "none" | "fade-in" | "slide-up" | "slide-left" | "slide-right";
export type SectionVisibility = "desktop" | "mobile" | "both";

export interface ThemeBlock {
  id: string;
  type: string;
  visible: boolean;
  order: number;
  settings: Record<string, unknown>;
  blocks?: ThemeBlock[];
}

export interface SectionSettings {
  typography?: Record<string, unknown>;
  spacing?: { top?: number; bottom?: number; left?: number; right?: number };
  background?: Record<string, unknown>;
  schemeId?: string;
  scrollAnimation?: ScrollAnimation;
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

export interface HeaderFooterConfig {
  settings: Record<string, unknown>;
  blocks: ThemeBlock[];
}

// --- Theme Settings: 18 categories, matching Shopify Horizon's real
// settings_schema.json, with a deliberate Dawn-style multi-scheme color
// system layered in per the confirmed spec. ---

export interface LogoSettings {
  defaultLogoUrl?: string;
  inverseLogoUrl?: string;
  desktopHeight: number;
  mobileHeight: number;
  faviconUrl?: string;
}

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

export type TextLineHeight = "tight" | "normal" | "loose";
export type TextLetterSpacing = "tight" | "normal" | "wide";
export type TextCase = "default" | "uppercase";
export type FontRole = "heading" | "accent";

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
}

export interface PageLayoutSettings {
  width: "narrow" | "normal" | "wide";
}

export interface AnimationSettings {
  pageTransition: boolean;
  productCardTransition: boolean;
  addToCart: boolean;
  cardHoverEffect: "none" | "lift" | "scale" | "zoom";
}

export interface BadgeSettings {
  position: "top_right" | "top_left" | "bottom_right" | "bottom_left";
  cornerRadius: number;
  saleSchemeId: string;
  soldOutSchemeId: string;
  font: "body" | "accent";
  case: TextCase;
}

export interface ButtonStyleSettings {
  borderThickness: number;
  cornerRadius: number;
  font: "body" | "accent";
  case: TextCase;
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
  mediaBorderStyle: "none" | "solid";
  mediaCornerRadius: number;
}

export interface DrawerSettings {
  schemeId: string;
  bordersStyle: "none" | "solid";
  dropShadow: boolean;
}

export interface IconSettings {
  stroke: "thin" | "default" | "heavy";
}

export interface InputFieldSettings {
  borderThickness: number;
  cornerRadius: number;
  textPreset: string;
}

export interface PopoverSettings {
  schemeId: string;
  cornerRadius: number;
  borders: "none" | "solid";
  dropShadow: boolean;
}

export interface PriceSettings {
  currencyCode: {
    productPages: boolean;
    productCards: boolean;
    cartItems: boolean;
    cartTotal: boolean;
  };
}

export interface ProductCardSettings {
  quickAdd: boolean;
  mobileQuickAdd: boolean;
  quickAddBackground: string;
  quickAddText: string;
  showSecondImageOnHover: boolean;
  showCarousel: boolean;
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
  borders: "none" | "solid";
  borderThickness: number;
  borderOpacity: number;
}

export interface VariantPickerSettings {
  borderThickness: number;
  cornerRadius: number;
  width: "fit" | "fill";
}

export interface CustomCssSettings {
  css: string;
}

export interface GlobalThemeSettings {
  logo: LogoSettings;
  colorSchemes: ColorScheme[];
  typography: TypographySettings;
  pageLayout: PageLayoutSettings;
  animations: AnimationSettings;
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
}

export interface ThemeConfig {
  globalSettings: GlobalThemeSettings;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  sections: ThemeSection[];
}
