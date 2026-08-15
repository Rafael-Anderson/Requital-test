import type { TextLetterSpacing, TextLineHeight } from "./theme-config-types";

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
