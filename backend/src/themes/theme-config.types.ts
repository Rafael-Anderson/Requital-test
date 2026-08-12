// Shape of the `theme.config`/`theme.publishedConfig` JSON blob — the new
// visual theme builder's data model (see prisma/migrations/
// 20260812130000_create_theme_table). Mirrored by hand in
// admin/lib/types.ts and storefront/lib/theme-config-types.ts, same
// no-shared-package convention as every other cross-app type in this
// codebase (FONT_CHOICES, THEME_COLOR_FIELDS, etc.).
//
// Header/Footer are global chrome (rendered on every storefront page, not
// just the homepage) — they get their own settings/elements slots here but
// are deliberately NOT part of `sections[]`, which governs homepage body
// content only. See the plan's "Scope decision" note.

export type ThemeSectionType =
  | 'announcement_bar'
  | 'hero'
  | 'featured_collections'
  | 'product_grid'
  | 'testimonials'
  | 'rich_text'
  | 'image_text'
  | 'newsletter';

export type ScrollAnimation = 'none' | 'fade-in' | 'slide-up' | 'slide-left' | 'slide-right';
export type SectionVisibility = 'desktop' | 'mobile' | 'both';

// Freeform element positioning within a section's own drag context (Header's
// logo/nav/search/cart/account; Hero's heading/subheading/CTA) — the data
// shape both the Phase 6 admin editor and the storefront's rendering must
// agree on. Defined now (Phase 1) since it's part of the schema/type shape,
// even though no UI writes non-default positions until Phase 6.
export interface ThemeElement {
  id: string;
  type: string;
  position: { zone: string; x?: number; y?: number };
  settings: Record<string, unknown>;
}

// Every section's shared controls (spec: "every section exposes at
// minimum" typography/spacing/background/scrollAnimation/visibility) plus
// whatever section-specific fields that type needs — deliberately not typed
// per-field beyond the shared ones, since section-specific settings vary by
// `type` and are only deep-validated client-side (see
// theme-config.validation.ts's own comment on why this is shallow).
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
  borderRadius?: 'sharp' | 'soft' | 'round';
  buttonStyle?: 'filled' | 'outline' | 'ghost';
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
