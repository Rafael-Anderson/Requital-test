// Phase B2 (design-token foundation) — the density scale's pure CSS-var
// resolver + applier. No DOM, no React (same shape as lib/motion.ts's
// resolveMotionCssVars / lib/radius.ts's resolveRadiusCssVars). Consumed by
// shop-context.tsx's applyDensityOverrides.
//
// CONTRACT — the byte-identical no-op:
//   resolveDensityCssVars(undefined | null | {} | { preset: <unknown> })  →  {}
//   → applyDensityCssVars writes nothing → the .theme-section-py /
//   .theme-grid-gap / .theme-heading-gap classes in globals.css each resolve to
//   their literal fallback (= the exact pre-B2 Tailwind value: py-8 = 2rem,
//   gap-4 sm:gap-6 = 1rem/1.5rem, mb-4 = 1rem). This is the ONLY guaranteed
//   no-op.
//
// `preset: 'cozy'` reproduces today's values explicitly, but it is a near-today
// baseline, NOT a promise of byte-identity — the only tested no-op is `density`
// unset / {} / no `preset` (same convention as B1 `radius: 'rounded'` /
// Phase-A `intensity: 'standard'`).
//
// Token names are NOT in a Tailwind v4 theme namespace (--section-* / --grid-*
// / --stack-* are not --spacing-* / --radius-* / etc.), so these never redefine
// a utility scale — but they still live on plain :root + the class fallbacks,
// never in @theme. See the B1 radius incident (CLAUDE.md Tailwind v4 note).

import type { DensityPreset, DensitySettings } from "./theme-config-types";

const PRESETS: readonly DensityPreset[] = ["compact", "cozy", "comfortable", "spacious"];

// rem per preset. `cozy` = today's values.
//   sectionPy   → .theme-section-py  padding-block   (was py-8 = 2rem)
//   gridGap     → .theme-grid-gap    gap  >=640px    (was sm:gap-6 = 1.5rem)
//   gridGapM    → .theme-grid-gap    gap  <640px     (was gap-4 = 1rem)
//   headingGap  → .theme-heading-gap margin-bottom   (was mb-4 = 1rem)
//   gutterX     → .theme-gutter-x    padding-inline <640px  (was px-4 = 1rem)
//   gutterXLg   → .theme-gutter-x    padding-inline >=640px (was sm:px-6 = 1.5rem)
const DENSITY_SCALE: Record<
  DensityPreset,
  { sectionPy: string; gridGap: string; gridGapM: string; headingGap: string; gutterX: string; gutterXLg: string }
> = {
  compact: { sectionPy: "1.5rem", gridGap: "1rem", gridGapM: "0.75rem", headingGap: "0.75rem", gutterX: "0.75rem", gutterXLg: "1rem" },
  cozy: { sectionPy: "2rem", gridGap: "1.5rem", gridGapM: "1rem", headingGap: "1rem", gutterX: "1rem", gutterXLg: "1.5rem" },
  comfortable: { sectionPy: "2.75rem", gridGap: "2rem", gridGapM: "1.25rem", headingGap: "1.25rem", gutterX: "1.25rem", gutterXLg: "2rem" },
  spacious: { sectionPy: "3.5rem", gridGap: "2.5rem", gridGapM: "1.5rem", headingGap: "1.5rem", gutterX: "1.5rem", gutterXLg: "2.5rem" },
};

export const DENSITY_CSS_VAR_NAMES: readonly string[] = [
  "--section-py",
  "--grid-gap",
  "--grid-gap-m",
  "--section-heading-gap",
  "--gutter-x",
  "--gutter-x-lg",
];

function isKnownPreset(v: unknown): v is DensityPreset {
  return typeof v === "string" && (PRESETS as readonly string[]).includes(v);
}

export function resolveDensityCssVars(density: DensitySettings | null | undefined): Record<string, string> {
  const preset = density?.preset;
  if (!isKnownPreset(preset)) return {};
  const s = DENSITY_SCALE[preset];
  return {
    "--section-py": s.sectionPy,
    "--grid-gap": s.gridGap,
    "--grid-gap-m": s.gridGapM,
    "--section-heading-gap": s.headingGap,
    "--gutter-x": s.gutterX,
    "--gutter-x-lg": s.gutterXLg,
  };
}

// Set the resolved vars; clear any this theme doesn't define — the SPA-leak
// guard (a client-side nav / preview postMessage from a density-configured
// theme to one without a preset must not leave stale --section-*/--grid-* on
// :root). Mirrors motion.ts's applyMotionCssVars.
export function applyDensityCssVars(
  root: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
  density: DensitySettings | null | undefined,
): void {
  const resolved = resolveDensityCssVars(density);
  for (const name of DENSITY_CSS_VAR_NAMES) {
    if (name in resolved) root.setProperty(name, resolved[name]);
    else root.removeProperty(name);
  }
}
