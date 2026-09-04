// Post-G0 batch (theme-templates-and-motion.md §8.3 item 1) — the product
// card hover effect's pure CSS-var resolver. Extracted out of shop-context.tsx
// (where these lived as inline maps since Phase A/B1) so the new values get
// the same resolver + SPA-leak-clear + unit-test discipline as
// motion.ts/radius.ts/density.ts. No DOM, no React.
//
// CONTRACT — the byte-identical no-op: `cardHoverEffect` is a required field
// (always 'none' at worst, never actually absent post-backfill), so there is
// no "unset" case to prove here the way radius/density/motion have one.
// Instead: resolveCardHoverCssVars('zoom' | 'rise' | 'swap' | 'none') — the
// four pre-batch values — must return EXACTLY what the three original inline
// maps returned, plus the three new vars resolved to their neutral value
// (filter "none"/"none", overlay opacity "0"). That's the parity proof for
// every existing shop; see card-hover.test.ts.

import type { AnimationSettings } from "./theme-config-types";

type CardHoverEffect = AnimationSettings["cardHoverEffect"];

// 'zoom' scales the image (--theme-card-hover-transform); 'rise'/'tilt'
// translate/rotate the card wrapper instead (--theme-card-hover-card-transform)
// — 'tilt' is a fixed-angle CSS-only rotate (no cursor tracking, the plan's
// §3.1 #10 "S version"). 'swap' has no CSS transform at all (handled via
// use-product-card-image-index.ts swapping which <img> is rendered).
const CARD_IMAGE_HOVER_TRANSFORM: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  zoom: "scale(var(--motion-hover-scale, 1.04))",
};
const CARD_WRAPPER_HOVER_TRANSFORM: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  rise: "translateY(var(--motion-hover-lift, -4px))",
  tilt: "rotate(-1.5deg)",
};
// 'shadow' reuses the same magnitude as 'rise' — the difference is 'shadow'
// has no paired transform above (no movement, box-shadow only, plan §3.1 #6).
const CARD_WRAPPER_HOVER_SHADOW: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  rise: "var(--motion-hover-shadow, 0 8px 20px rgba(15,23,22,0.12))",
  shadow: "var(--motion-hover-shadow, 0 8px 20px rgba(15,23,22,0.12))",
};
// 'desaturate' — image starts desaturated, goes full colour on hover (plan
// §3.1 #8). Every other effect leaves both at "none".
const CARD_IMAGE_FILTER_BASE: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  desaturate: "saturate(0.55)",
};
const CARD_IMAGE_FILTER_HOVER: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  desaturate: "saturate(1)",
};
// 'overlay' — a scheme-tinted wash fades in over the image on hover (plan
// §3.1 #7). Every other effect leaves this at 0 (invisible).
const CARD_HOVER_OVERLAY_OPACITY: Partial<Record<NonNullable<CardHoverEffect>, string>> = {
  overlay: "0.12",
};

export const CARD_HOVER_CSS_VAR_NAMES = [
  "--theme-card-hover-transform",
  "--theme-card-hover-card-transform",
  "--theme-card-hover-card-shadow",
  "--theme-card-hover-filter-base",
  "--theme-card-hover-filter-hover",
  "--theme-card-hover-overlay-opacity",
] as const;

export function resolveCardHoverCssVars(effect: CardHoverEffect | undefined | null): Record<string, string> {
  if (!effect) return {};
  return {
    "--theme-card-hover-transform": CARD_IMAGE_HOVER_TRANSFORM[effect] ?? "none",
    "--theme-card-hover-card-transform": CARD_WRAPPER_HOVER_TRANSFORM[effect] ?? "none",
    "--theme-card-hover-card-shadow": CARD_WRAPPER_HOVER_SHADOW[effect] ?? "none",
    "--theme-card-hover-filter-base": CARD_IMAGE_FILTER_BASE[effect] ?? "none",
    "--theme-card-hover-filter-hover": CARD_IMAGE_FILTER_HOVER[effect] ?? "none",
    "--theme-card-hover-overlay-opacity": CARD_HOVER_OVERLAY_OPACITY[effect] ?? "0",
  };
}

// Set the resolved vars; clear any this effect doesn't define — the SPA-leak
// guard (mirrors applyMotionCssVars/applyRadiusCssVars/applyDensityCssVars).
// `cardHoverEffect` is required (not optional) so this rarely has anything to
// clear in practice, but a preview postMessage carrying a config with a
// missing/unrecognised value must not leave a PREVIOUS theme's vars stuck.
export function applyCardHoverCssVars(
  root: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
  effect: CardHoverEffect | undefined | null,
): void {
  const resolved = resolveCardHoverCssVars(effect);
  for (const name of CARD_HOVER_CSS_VAR_NAMES) {
    if (name in resolved) root.setProperty(name, resolved[name]);
    else root.removeProperty(name);
  }
}
