// Banner height limits (px). Mirrors backend/src/themes/constants.ts
// (BANNER_HEIGHT_MIN / BANNER_HEIGHT_MAX) and storefront/lib/banner-height.ts; the backend
// validates, the storefront clamps again at render, this only drives the editor's controls.
export const BANNER_HEIGHT_MIN = 120;
export const BANNER_HEIGHT_MAX = 900;

/** A typed value turned into a valid height, or undefined when it is empty or not a number. */
export function parseBannerHeight(raw: string): number | undefined {
  if (raw.trim() === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(BANNER_HEIGHT_MAX, Math.max(BANNER_HEIGHT_MIN, Math.round(n)));
}
