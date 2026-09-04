// Phase B1 (design-token foundation) — the radius scale's pure CSS-var
// resolver + applier. No DOM, no React (same shape as lib/motion.ts's
// resolveMotionCssVars / applyMotionCssVars). Consumed by shop-context.tsx's
// applyRadiusOverrides.
//
// CONTRACT — the byte-identical no-op:
//   resolveRadiusCssVars(undefined | {} | { preset: <unset/unknown> } |
//   { applyToButtons: true })  →  {}
//   → applyRadiusCssVars writes nothing → every `var(--radius-*, <literal>)`
//   in globals.css / the .theme-round-* classes resolves to its literal
//   fallback (= the exact pre-B1 Tailwind value: rounded-md 0.375rem,
//   rounded-lg 0.5rem, rounded-xl 0.75rem). This is the ONLY no-op.
//
// `preset: 'rounded'` is a deliberate near-today baseline (md 8px = rounded-lg,
// lg 12px = rounded-xl), NOT byte-identical to unset — the only true no-op is
// `radius` unset / `{}` / no `preset`.
//
// `applyToButtons` is NOT resolved here — it gates the `--theme-radius` bridge
// in shop-context.tsx (whether the scale's --radius-md also drives
// buttons/inputs/section-image-containers). On its own it emits no --radius-*.

import type { RadiusPreset, RadiusSettings } from "./theme-config-types";

const PRESETS: readonly RadiusPreset[] = ["sharp", "subtle", "rounded", "soft", "pill"];

// px per preset. `rounded` ≈ today.
const RADIUS_SCALE: Record<RadiusPreset, { sm: number; md: number; lg: number }> = {
  sharp: { sm: 0, md: 0, lg: 0 },
  subtle: { sm: 2, md: 4, lg: 6 },
  rounded: { sm: 6, md: 8, lg: 12 },
  soft: { sm: 10, md: 16, lg: 22 },
  pill: { sm: 12, md: 24, lg: 9999 },
};

export const RADIUS_CSS_VAR_NAMES: readonly string[] = ["--radius-sm", "--radius-md", "--radius-lg"];

function isKnownPreset(v: unknown): v is RadiusPreset {
  return typeof v === "string" && (PRESETS as readonly string[]).includes(v);
}

export function resolveRadiusCssVars(radius: RadiusSettings | null | undefined): Record<string, string> {
  const preset = radius?.preset;
  if (!isKnownPreset(preset)) return {};
  const s = RADIUS_SCALE[preset];
  return {
    "--radius-sm": `${s.sm}px`,
    "--radius-md": `${s.md}px`,
    "--radius-lg": `${s.lg}px`,
  };
}

// Set the resolved vars; clear any this theme doesn't define — the SPA-leak
// guard (a client-side nav / preview postMessage from a radius-scaled theme to
// one without a preset must not leave stale --radius-* on :root). Mirrors
// motion.ts's applyMotionCssVars.
export function applyRadiusCssVars(
  root: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
  radius: RadiusSettings | null | undefined,
): void {
  const resolved = resolveRadiusCssVars(radius);
  for (const name of RADIUS_CSS_VAR_NAMES) {
    if (name in resolved) root.setProperty(name, resolved[name]);
    else root.removeProperty(name);
  }
}

// The `--theme-radius` bridge value — buttons, the newsletter input, and the
// Featured/ImageText/ProductGrid section image containers all read
// `var(--theme-radius, 8px)`. `buttons.primary.cornerRadius` ALWAYS wins unless
// the merchant explicitly turns on `radius.applyToButtons` (no seed sentinel).
export function resolveThemeRadius(
  radius: RadiusSettings | null | undefined,
  buttonCornerRadius: number,
): string {
  if (radius?.applyToButtons) {
    const md = resolveRadiusCssVars(radius)["--radius-md"];
    if (md) return md;
  }
  return `${buttonCornerRadius}px`;
}
