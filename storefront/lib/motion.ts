// Phase A (motion foundation) — the global motion model's pure CSS-var
// resolver. No DOM, no React (same convention as resolveThemeCssVars /
// resolveSchemeCssVars in shop-context.tsx). Consumed by shop-context.tsx's
// applyMotionOverrides.
//
// CONTRACT — the byte-identical no-op:
//   resolveMotionCssVars(undefined | {} | { intensity: <unset / unknown> })
//   returns {} → applyMotionOverrides writes nothing → every
//   `var(--motion-*, <literal>)` in globals.css / the components resolves to its
//   literal fallback (= the exact pre-Phase-A value). This is the ONLY true
//   no-op.
//
// `intensity: 'standard'` is a DELIBERATE near-today baseline, NOT
// byte-identical to unset: --motion-duration-base is 320ms (vs today's 300ms),
// --motion-duration-fast folds today's two real values (150ms / 200ms) to one,
// and --motion-ease is cubic-bezier(0.22,0.61,0.36,1) (vs the literal
// `ease-out`). A merchant switching unset → 'standard' should barely notice; a
// reader must not assume 'standard' == today.
//
// Mobile tier: this also emits a parallel `--motion-*-m` set at `intensity`
// stepped DOWN one level. globals.css's `@media (max-width: 639px)` block maps
// the base token names to these `-m` names (with a literal fallback = today's
// value, so motion-unset ⇒ mobile also byte-identical). The JS-only continuous
// effects (parallax / kenBurns / decorativeParallax / customCursor) land in a
// later phase and self-gate on matchMedia('(max-width: 639px)') directly.

import type { MotionSettings } from "./theme-config-types";

type Intensity = NonNullable<MotionSettings["intensity"]>;
type NamedEasing = NonNullable<MotionSettings["easing"]>;

const INTENSITIES: readonly Intensity[] = ["none", "subtle", "standard", "expressive"];

// One step gentler, for the sub-640px mobile tier.
const MOBILE_STEP_DOWN: Record<Intensity, Intensity> = {
  none: "none",
  subtle: "none",
  standard: "subtle",
  expressive: "standard",
};

interface TokenSet {
  durationFast: number; // ms, pre-speed
  durationBase: number;
  durationSlow: number;
  entranceDistance: number; // px
  stagger: number; // ms, pre-speed
  hoverLift: number; // px (negative = up)
  hoverScale: number;
  hoverShadow: string;
  ease: string;
  marquee: number; // seconds
}

// See docs/plans/theme-templates-and-motion.md §2.2 + §8.1 for this table. The
// `standard` column mirrors today's feel (not its exact numbers — see header).
const TOKENS: Record<Intensity, TokenSet> = {
  none: {
    durationFast: 0,
    durationBase: 0,
    durationSlow: 0,
    entranceDistance: 0,
    stagger: 0,
    hoverLift: 0,
    hoverScale: 1,
    hoverShadow: "none",
    ease: "linear",
    marquee: 18,
  },
  subtle: {
    durationFast: 120,
    durationBase: 220,
    durationSlow: 380,
    entranceDistance: 12,
    stagger: 40,
    hoverLift: -2,
    hoverScale: 1.02,
    hoverShadow: "0 4px 12px rgba(15,23,22,0.08)",
    ease: "cubic-bezier(0.33,1,0.68,1)",
    marquee: 24,
  },
  standard: {
    durationFast: 150,
    durationBase: 320,
    durationSlow: 600,
    entranceDistance: 24,
    stagger: 60,
    hoverLift: -4,
    hoverScale: 1.04,
    hoverShadow: "0 8px 20px rgba(15,23,22,0.12)",
    ease: "cubic-bezier(0.22,0.61,0.36,1)",
    marquee: 18,
  },
  expressive: {
    durationFast: 220,
    durationBase: 480,
    durationSlow: 950,
    entranceDistance: 48,
    stagger: 110,
    hoverLift: -8,
    hoverScale: 1.06,
    hoverShadow: "0 16px 40px rgba(15,23,22,0.18)",
    ease: "cubic-bezier(0.34,1.3,0.64,1)",
    marquee: 12,
  },
};

// `standard` keeps the intensity's own curve; the others override it regardless
// of intensity.
const NAMED_EASE: Record<NamedEasing, string | null> = {
  standard: null,
  gentle: "cubic-bezier(0.33,1,0.68,1)",
  snappy: "cubic-bezier(0.4,0,0.2,1)",
  overshoot: "cubic-bezier(0.34,1.56,0.64,1)",
  linear: "linear",
};

function clampSpeed(speed: number | undefined): number {
  if (typeof speed !== "number" || !Number.isFinite(speed)) return 1;
  return Math.min(2, Math.max(0.5, speed));
}

function isKnownIntensity(v: unknown): v is Intensity {
  return typeof v === "string" && (INTENSITIES as readonly string[]).includes(v);
}

// Every CSS var this module can emit (desktop + `-m` mobile tier). Used by
// shop-context.tsx's applyMotionOverrides to CLEAR stale props on a
// client-side navigation between two shops (one with `motion`, one without) —
// the same SPA-leak guard applyTheme already has.
const BASE_VAR_NAMES = [
  "--motion-duration-fast",
  "--motion-duration-base",
  "--motion-duration-slow",
  "--motion-entrance-distance",
  "--motion-stagger",
  "--motion-hover-lift",
  "--motion-hover-scale",
  "--motion-hover-shadow",
  "--motion-ease",
  "--motion-marquee-duration",
] as const;

export const MOTION_CSS_VAR_NAMES: readonly string[] = [
  ...BASE_VAR_NAMES,
  ...BASE_VAR_NAMES.map((n) => `${n}-m`),
];

// One token set → its CSS-var map. `suffix` is "" for the desktop tokens,
// "-m" for the mobile tier.
function tokenVars(t: TokenSet, speed: number, ease: string, suffix: string): Record<string, string> {
  const ms = (n: number) => `${Math.round(n * speed)}ms`;
  return {
    [`--motion-duration-fast${suffix}`]: ms(t.durationFast),
    [`--motion-duration-base${suffix}`]: ms(t.durationBase),
    [`--motion-duration-slow${suffix}`]: ms(t.durationSlow),
    [`--motion-entrance-distance${suffix}`]: `${t.entranceDistance}px`,
    [`--motion-stagger${suffix}`]: ms(t.stagger),
    [`--motion-hover-lift${suffix}`]: `${t.hoverLift}px`,
    [`--motion-hover-scale${suffix}`]: String(t.hoverScale),
    [`--motion-hover-shadow${suffix}`]: t.hoverShadow,
    [`--motion-ease${suffix}`]: ease,
    [`--motion-marquee-duration${suffix}`]: `${t.marquee}s`,
  };
}

export function resolveMotionCssVars(motion: MotionSettings | null | undefined): Record<string, string> {
  const intensity = motion?.intensity;
  if (!isKnownIntensity(intensity)) return {};

  const speed = clampSpeed(motion?.speed);
  const namedEase = motion?.easing ? NAMED_EASE[motion.easing] : null;

  const base = TOKENS[intensity];
  const mobile = TOKENS[MOBILE_STEP_DOWN[intensity]];

  return {
    ...tokenVars(base, speed, namedEase ?? base.ease, ""),
    ...tokenVars(mobile, speed, namedEase ?? mobile.ease, "-m"),
  };
}

// Applies the resolved tokens onto a style declaration AND removes any
// --motion-* prop this `motion` doesn't define. The removal is the SPA-leak
// guard: a client-side navigation (or a preview postMessage) from a
// motion-configured theme to one without `intensity` must not leave the
// previous theme's --motion-* props on :root. Mirrors what applyTheme does by
// always writing a full var map; here the map can shrink to {}, so stale keys
// are cleared explicitly. `root` is `document.documentElement.style` in the app
// (see shop-context.tsx's applyMotionOverrides).
export function applyMotionCssVars(
  root: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
  motion: MotionSettings | null | undefined,
): void {
  const resolved = resolveMotionCssVars(motion);
  for (const name of MOTION_CSS_VAR_NAMES) {
    if (name in resolved) root.setProperty(name, resolved[name]);
    else root.removeProperty(name);
  }
}
