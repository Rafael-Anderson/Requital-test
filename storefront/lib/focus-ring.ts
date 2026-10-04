import { contrastBetween } from "./color-contrast";

// The keyboard focus ring is two-tone (globals.css): an outline in --theme-focus-ring
// with a halo in --theme-focus-halo between it and the element. Whatever colour the
// surface is, one of the two tones is at least sqrt(C) away from it, where C is the
// contrast between the two tones (the surface's luminance lies somewhere between theirs).
// WCAG 1.4.11 asks 3:1 for a focus indicator, so the pair must have C >= 9. A scheme's
// text and background normally clear that by a wide margin (all four starter templates
// are above 10); one that does not (a merchant's grey-on-grey) gets plain black and white
// (C = 21, so at least 4.58:1 against any surface).
export const FOCUS_RING_MIN_PAIR_CONTRAST = 9;

const FALLBACK = { ring: "#000000", halo: "#ffffff" } as const;

export function resolveFocusRing(text: string, background: string): { ring: string; halo: string } {
  const c = contrastBetween(text, background);
  // Unknown (not a plain hex) is not a pass.
  if (c === null || c < FOCUS_RING_MIN_PAIR_CONTRAST) return { ...FALLBACK };
  return { ring: text, halo: background };
}

// Worst-case contrast of the ring against a surface: the better of its two tones. Used by
// the unit test to prove the guarantee over the starter templates' real surfaces.
export function focusRingContrastOn(surface: string, ring: { ring: string; halo: string }): number {
  return Math.max(contrastBetween(surface, ring.ring) ?? 0, contrastBetween(surface, ring.halo) ?? 0);
}

export function resolveFocusRingCssVars(text: string, background: string): Record<string, string> {
  const r = resolveFocusRing(text, background);
  return { "--theme-focus-ring": r.ring, "--theme-focus-halo": r.halo };
}
