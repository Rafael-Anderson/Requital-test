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
