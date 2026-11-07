// Banner height bounds (px). Mirrored by hand in backend/src/themes/theme-config.validation.ts
// and admin/lib/banner-height.ts.
export const BANNER_HEIGHT_MIN = 120;
export const BANNER_HEIGHT_MAX = 900;

export function validBannerHeight(value: unknown): number | undefined {
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= BANNER_HEIGHT_MIN &&
    value <= BANNER_HEIGHT_MAX
    ? value
    : undefined;
}

export interface BannerHeights {
  desktop: number;
  mobile: number;
}

// `fallback` is what the banner rendered before this setting existed, so a shop
// that never sets it keeps its current height on every viewport. With no
// fallback and no valid desktop value there is nothing to apply (null).
export function resolveBannerHeights(
  desktop: unknown,
  mobile: unknown,
  fallback?: number,
): BannerHeights | null {
  const d = validBannerHeight(desktop) ?? fallback;
  if (d === undefined) return null;
  return { desktop: d, mobile: validBannerHeight(mobile) ?? d };
}

// CSS custom properties read by `h-[var(--banner-h)] md:h-[var(--banner-h-md)]`.
export function bannerHeightVars(h: BannerHeights): Record<string, string> {
  return { "--banner-h": `${h.mobile}px`, "--banner-h-md": `${h.desktop}px` };
}
