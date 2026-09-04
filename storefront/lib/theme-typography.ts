import type { TextLetterSpacing, TextLineHeight, TypeScale, TypographyPairing } from "./theme-config-types";

// Shopify-style named presets (Tight/Normal/Loose, Tight/Normal/Wide) ->
// real CSS values — the admin editor collects the named enum, the
// storefront needs an actual number/unit to set on the element.
export const LINE_HEIGHT_VALUES: Record<TextLineHeight, number> = {
  tight: 1.1,
  normal: 1.4,
  loose: 1.7,
};

export const LETTER_SPACING_VALUES: Record<TextLetterSpacing, string> = {
  tight: "-0.02em",
  normal: "0",
  wide: "0.04em",
};

export function resolveLineHeight(value: TextLineHeight | undefined): number {
  return LINE_HEIGHT_VALUES[value ?? "normal"];
}

export function resolveLetterSpacing(value: TextLetterSpacing | undefined): string {
  return LETTER_SPACING_VALUES[value ?? "normal"];
}

// --- Phase B1 (design-token foundation) ---

// typography.pairing — 7 named font bundles. `resolveTypographyPairing`
// returns the 4 role fonts, or null when unset/unknown (⇒ shop-context.tsx
// runs the existing per-role bodyFont/headingFont/… reads, today's behaviour).
export interface FontPairing {
  headingFont: string;
  bodyFont: string;
  accentFont: string;
  subheadingFont: string;
}

const PAIRINGS: Record<TypographyPairing, FontPairing> = {
  "modern-sans": { headingFont: "Inter", bodyFont: "Inter", accentFont: "Inter", subheadingFont: "Inter" },
  "editorial-serif": { headingFont: "Fraunces", bodyFont: "Inter", accentFont: "Fraunces", subheadingFont: "Inter" },
  "warm-humanist": { headingFont: "Fraunces", bodyFont: "Nunito Sans", accentFont: "Fraunces", subheadingFont: "Nunito Sans" },
  grotesque: { headingFont: "Space Grotesk", bodyFont: "IBM Plex Sans", accentFont: "Space Grotesk", subheadingFont: "IBM Plex Sans" },
  classic: { headingFont: "Cormorant Garamond", bodyFont: "Lato", accentFont: "Cormorant Garamond", subheadingFont: "Lato" },
  "bold-display": { headingFont: "Archivo Black", bodyFont: "Inter", accentFont: "Archivo Black", subheadingFont: "Inter" },
  "handwritten-accent": { headingFont: "Inter", bodyFont: "Inter", accentFont: "Caveat", subheadingFont: "Inter" },
};

export function resolveTypographyPairing(pairing: TypographyPairing | string | undefined | null): FontPairing | null {
  return typeof pairing === "string" && pairing in PAIRINGS ? PAIRINGS[pairing as TypographyPairing] : null;
}

// typography.scale — an explicit px table per name (not runtime exponentiation
// — a large ratio over 6 steps explodes). `resolveScaleSizes` returns the
// { h1..h6 } px map or null when unset/unknown (⇒ applyHeadingPreset keeps
// using each preset's own `.size`, today's behaviour — the stored h1–h6 sizes
// are never mutated). `default` ≈ DEFAULT_THEME_CONFIG's seed sizes.
export type HeadingKey = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

const TYPE_SCALE: Record<TypeScale, Record<HeadingKey, number>> = {
  compact: { h1: 40, h2: 32, h3: 26, h4: 21, h5: 18, h6: 16 },
  default: { h1: 48, h2: 36, h3: 28, h4: 22, h5: 18, h6: 16 },
  spacious: { h1: 56, h2: 42, h3: 32, h4: 24, h5: 19, h6: 16 },
  dramatic: { h1: 64, h2: 46, h3: 34, h4: 25, h5: 20, h6: 16 },
};

export function resolveScaleSizes(scale: TypeScale | string | undefined | null): Record<HeadingKey, number> | null {
  return typeof scale === "string" && scale in TYPE_SCALE ? TYPE_SCALE[scale as TypeScale] : null;
}
