// Announcement-bar marquee speed, pixels per second. Absent / null = the default.
// Mirrors backend/src/themes/constants.ts (which enforces it) and
// storefront/lib/marquee.ts: change all three together.
export const MARQUEE_SPEED_MIN = 10;
export const MARQUEE_SPEED_MAX = 200;
export const MARQUEE_SPEED_DEFAULT = 40;

export function effectiveMarqueeSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MARQUEE_SPEED_DEFAULT;
  return Math.min(MARQUEE_SPEED_MAX, Math.max(MARQUEE_SPEED_MIN, value));
}
