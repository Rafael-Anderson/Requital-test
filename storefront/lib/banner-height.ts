// Banner height settings (collection page banner, Hero section backdrop).
//
// A merchant sets a height in px for desktop and for mobile. Width is never a setting:
// the image fills the width with object-fit: cover. Values are clamped here at render
// time as well as validated by the backend, because a config saved before the
// validation existed (or edited by hand) must never be able to produce a 0px or a
// 5000px banner. `undefined` means "the setting was never touched": the caller keeps
// its existing rendered height, which is what makes this a no-op for existing shops.
import type { CSSProperties } from "react";

export const BANNER_HEIGHT_MIN = 120;
export const BANNER_HEIGHT_MAX = 900;
// Matches backend/src/themes/theme-config.validation.ts and admin/lib/banner-height.ts.

export function clampBannerHeight(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
  return Math.min(BANNER_HEIGHT_MAX, Math.max(BANNER_HEIGHT_MIN, Math.round(value)));
}

/**
 * CSS custom properties for .theme-banner-h / .theme-banner-minh (globals.css): the
 * mobile value applies below 640px, the desktop value from 640px up. Setting only one of
 * the two uses it for both. Returns undefined when neither was set.
 */
export function bannerHeightVars(desktop: unknown, mobile: unknown): CSSProperties | undefined {
  const d = clampBannerHeight(desktop);
  const m = clampBannerHeight(mobile);
  if (d === undefined && m === undefined) return undefined;
  return {
    ["--theme-banner-h" as string]: `${d ?? m}px`,
    ["--theme-banner-h-m" as string]: `${m ?? d}px`,
  };
}
