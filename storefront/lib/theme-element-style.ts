import type { CSSProperties } from "react";
import { resolveLetterSpacing, resolveLineHeight } from "./theme-typography";
import type { TextLetterSpacing, TextLineHeight } from "./theme-config-types";

// Pure per-block style resolution for the theme builder's in-preview
// element editing (ElementSettingsPanel, admin-side) — a block's settings
// are free-form JSON (see backend theme-config.validation.ts's "shallow
// beyond structure" comment), so these fields have no schema of their own
// beyond what these functions choose to read. Kept separate from
// SectionWrapper's own section-level typography/background handling (which
// predates this and stays section-scoped) — this is specifically the
// per-element override layer selected via double-click in preview mode.
// Directly unit-tested, no DOM access, same convention as
// shop-context.tsx's resolveThemeCssVars.

export interface TextElementSettings {
  fontSize?: number;
  fontWeight?: string;
  color?: string;
  fontFamily?: string;
  letterSpacing?: TextLetterSpacing;
  textAlign?: "left" | "center" | "right";
  textTransform?: "none" | "uppercase";
  lineHeight?: TextLineHeight;
}

export function resolveTextElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as TextElementSettings;
  const style: CSSProperties = {};
  if (typeof s.fontSize === "number") style.fontSize = `${s.fontSize}px`;
  if (typeof s.fontWeight === "string") style.fontWeight = s.fontWeight;
  if (typeof s.color === "string") style.color = s.color;
  if (typeof s.fontFamily === "string") style.fontFamily = `"${s.fontFamily}", var(--theme-body-font, inherit)`;
  if (s.letterSpacing) style.letterSpacing = resolveLetterSpacing(s.letterSpacing);
  if (s.textAlign) style.textAlign = s.textAlign;
  if (s.textTransform === "uppercase") style.textTransform = "uppercase";
  if (s.lineHeight) style.lineHeight = resolveLineHeight(s.lineHeight);
  return style;
}

// Global Theme Settings > Buttons style (globalSettings.buttons.primary,
// applied via CSS vars set in shop-context.tsx's applyThemeConfigOverrides)
// — every primary-style button in a section (Hero CTA, Newsletter submit,
// ...) starts from this, then layers its own per-block override
// (resolveButtonElementStyle below) on top so a merchant who's customized
// one specific button still sees that win over the global default.
export function themeButtonBaseStyle(): CSSProperties {
  return {
    // Legacy Layout mode's Button shape (--theme-btn-primary-radius, see
    // shop-context.tsx's applyLegacyThemeOverrides) takes precedence over
    // the new Buttons category's own cornerRadius (--theme-radius) here —
    // a deliberate, flagged precedence call (see that function's own
    // comment), not an oversight.
    borderRadius: "var(--theme-btn-primary-radius, var(--theme-radius, 8px))",
    borderWidth: "var(--theme-button-border-width, 0px)",
    borderStyle: "solid",
    borderColor: "currentColor",
    textTransform: "var(--theme-button-text-transform, none)" as CSSProperties["textTransform"],
    fontFamily: "var(--theme-button-font, inherit)",
  };
}

// Legacy Layout mode's Button fill (solid/outline — "ghost" is handled
// defensively even though the real ButtonFill schema only has these two
// values today, since the union is easy to extend later and costs nothing
// to handle now). Reads the raw --theme-btn-fill CSS var (a string, not a
// px/color value) rather than a JS prop, matching applyLegacyThemeOverrides'
// own choice to expose it that way. "solid" (or unset) returns {} — the
// element's own bg-accent/text-accent-foreground classes already render
// the solid look, no override needed.
export function resolveButtonFillStyle(fill: string | undefined): CSSProperties {
  if (fill === "outline") {
    return {
      background: "transparent",
      color: "var(--color-accent)",
      borderColor: "var(--color-accent)",
      borderWidth: "2px",
    };
  }
  if (fill === "ghost") {
    return {
      background: "transparent",
      color: "var(--color-accent)",
      borderColor: "transparent",
      borderWidth: "0px",
    };
  }
  return {};
}

export interface ButtonElementSettings {
  backgroundColor?: string;
  textColor?: string;
  borderRadius?: number;
  borderWidth?: number;
  borderColor?: string;
  paddingX?: number;
  paddingY?: number;
  fontSize?: number;
  fullWidth?: boolean;
}

export function resolveButtonElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as ButtonElementSettings;
  const style: CSSProperties = {};
  if (typeof s.backgroundColor === "string") style.background = s.backgroundColor;
  if (typeof s.textColor === "string") style.color = s.textColor;
  if (typeof s.borderRadius === "number") style.borderRadius = `${s.borderRadius}px`;
  if (typeof s.borderWidth === "number") {
    style.borderWidth = `${s.borderWidth}px`;
    style.borderStyle = "solid";
    style.borderColor = typeof s.borderColor === "string" ? s.borderColor : "transparent";
  }
  if (typeof s.paddingX === "number") {
    style.paddingLeft = `${s.paddingX}px`;
    style.paddingRight = `${s.paddingX}px`;
  }
  if (typeof s.paddingY === "number") {
    style.paddingTop = `${s.paddingY}px`;
    style.paddingBottom = `${s.paddingY}px`;
  }
  if (typeof s.fontSize === "number") style.fontSize = `${s.fontSize}px`;
  if (s.fullWidth) {
    style.display = "block";
    style.width = "100%";
    style.textAlign = "center";
  }
  return style;
}

export interface ImageElementSettings {
  objectFit?: "cover" | "contain" | "fill";
  width?: number;
  borderRadius?: number;
}

export function resolveImageElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as ImageElementSettings;
  const style: CSSProperties = {};
  if (s.objectFit) style.objectFit = s.objectFit;
  if (typeof s.width === "number") style.width = `${s.width}px`;
  if (typeof s.borderRadius === "number") style.borderRadius = `${s.borderRadius}px`;
  return style;
}

export interface NavElementSettings {
  fontSize?: number;
  color?: string;
  hoverColor?: string;
  fontWeight?: string;
  showOnMobile?: boolean;
}

// Nav's hover state can't be expressed as an inline style — callers pair
// this with the `.theme-nav-link:hover` rule in globals.css, which reads
// --theme-nav-hover-color off whatever ancestor sets it (see MenuBar.tsx).
export function resolveNavElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as NavElementSettings;
  const style: CSSProperties & Record<string, string> = {};
  if (typeof s.fontSize === "number") style.fontSize = `${s.fontSize}px`;
  if (typeof s.color === "string") style.color = s.color;
  if (typeof s.fontWeight === "string") style.fontWeight = s.fontWeight;
  if (typeof s.hoverColor === "string") style["--theme-nav-hover-color"] = s.hoverColor;
  return style;
}

// lucide-react's own default strokeWidth is 2 — "default" maps to that
// exact value so a shop that never touches Theme Settings > Icons renders
// pixel-identical to before this was wired up. A numeric SVG prop, not a
// CSS var — every icon-rendering component (ThemeDrivenHeader, SearchBar)
// reads globalSettings.icons.stroke directly via useShop() and calls this.
const ICON_STROKE_WIDTH: Record<string, number> = { thin: 1.25, default: 2, heavy: 2.75 };

export function resolveIconStrokeWidth(stroke: string | undefined): number {
  return ICON_STROKE_WIDTH[stroke ?? "default"] ?? 2;
}

export interface IconElementSettings {
  color?: string;
  size?: number;
}

// Per-element override for a single icon (search/cart/account) selected in
// preview — layered on top of the global stroke-width above, same
// "specific overrides general" pattern as every other resolve* function.
export function resolveIconElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as IconElementSettings;
  const style: CSSProperties = {};
  if (typeof s.color === "string") style.color = s.color;
  if (typeof s.size === "number") {
    style.width = `${s.size}px`;
    style.height = `${s.size}px`;
  }
  return style;
}

// Theme Settings > Typography's 7 text presets (paragraph, h1-h6) — the CSS
// vars themselves have been set in shop-context.tsx's applyThemeConfigOverrides
// since this system shipped, but nothing ever read them (confirmed via grep:
// zero references outside that one file), so every one of these presets was
// a dead setting. Fallbacks match this app's pre-existing Tailwind defaults
// for each tag (text-4xl/3xl/2xl/xl/lg/base/sm, leading-normal) so a shop with
// no theme.config (or a preset field left at its seed default) renders
// pixel-identical to before this was wired up. A single non-responsive value,
// same simplification themeButtonBaseStyle's --theme-radius already makes —
// true per-breakpoint theme sizing isn't worth a media query here.
const TEXT_PRESET_FALLBACK_SIZE: Record<string, string> = {
  h1: "36px",
  h2: "30px",
  h3: "24px",
  h4: "20px",
  h5: "18px",
  h6: "16px",
  paragraph: "16px",
};

export type TextPresetKey = keyof typeof TEXT_PRESET_FALLBACK_SIZE;

export function themeTextPresetStyle(preset: TextPresetKey): CSSProperties {
  const style: CSSProperties = {
    fontSize: `var(--text-${preset}-size, ${TEXT_PRESET_FALLBACK_SIZE[preset]})`,
    lineHeight: `var(--text-${preset}-line-height, 1.4)`,
  };
  // Paragraph has no letterSpacing/case fields (ParagraphTextPreset is
  // size+lineHeight only, per the real Horizon schema) — shop-context.tsx
  // never sets --text-paragraph-letter-spacing/-transform, so referencing
  // them here would just be dead var() lookups.
  if (preset !== "paragraph") {
    style.letterSpacing = `var(--text-${preset}-letter-spacing, normal)`;
    style.textTransform = `var(--text-${preset}-transform, none)` as CSSProperties["textTransform"];
    style.fontFamily = `var(--text-${preset}-font, var(--theme-heading-font, inherit))`;
  }
  return style;
}

export interface PriceElementSettings {
  showCurrencyCode?: boolean;
  fontSize?: number;
  color?: string;
}

export function resolvePriceElementStyle(settings: Record<string, unknown>): CSSProperties {
  const s = settings as PriceElementSettings;
  const style: CSSProperties = {};
  if (typeof s.fontSize === "number") style.fontSize = `${s.fontSize}px`;
  if (typeof s.color === "string") style.color = s.color;
  return style;
}
