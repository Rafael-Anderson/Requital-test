// Mirrors backend/src/themes/theme-config.types.ts and admin/lib/types.ts by
// hand — same no-shared-package convention as every other cross-app type in
// this codebase.

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

export interface ThemeElement {
  id: string;
  type: string;
  position: { zone: string; x?: number; y?: number };
  settings: Record<string, unknown>;
}

export interface SectionSettings {
  typography?: Record<string, unknown>;
  spacing?: { top?: number; bottom?: number; left?: number; right?: number };
  background?: Record<string, unknown>;
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
  elements?: ThemeElement[];
}

export interface GlobalThemeSettings {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  bodyFont?: string;
  headingFont?: string;
  borderRadius?: "sharp" | "soft" | "round";
  buttonStyle?: "filled" | "outline" | "ghost";
  maxWidth?: number;
}

export interface HeaderFooterConfig {
  settings: Record<string, unknown>;
  elements?: ThemeElement[];
}

export interface ThemeConfig {
  globalSettings: GlobalThemeSettings;
  header: HeaderFooterConfig;
  footer: HeaderFooterConfig;
  sections: ThemeSection[];
}
