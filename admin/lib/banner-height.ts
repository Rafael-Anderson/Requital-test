// Mirrors storefront/lib/banner-height.ts and backend theme-config.validation.ts.
export const BANNER_HEIGHT_MIN = 120;
export const BANNER_HEIGHT_MAX = 900;

export function clampBannerHeight(value: number): number {
  if (!Number.isFinite(value)) return BANNER_HEIGHT_MIN;
  return Math.min(BANNER_HEIGHT_MAX, Math.max(BANNER_HEIGHT_MIN, Math.round(value)));
}
