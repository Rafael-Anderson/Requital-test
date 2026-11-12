// How many times one message must repeat so that ONE HALF of the marquee track is at least as
// wide as the bar. The track is two identical halves and loops by translating exactly one half,
// so a half narrower than the bar leaves the right side of the bar empty (the bug this fixes).

// The widest bar we try to cover before we have measured anything (server render, first paint):
// a 4K monitor. Measuring can only ADD copies after that, never remove them, so the loop never
// jumps while it is running.
export const ASSUMED_BAR_WIDTH_PX = 3840;
const AVG_CHAR_PX = 7; // text-xs average advance, rough on purpose
export const ITEM_PADDING_PX = 32; // px-4 each side

export function estimateItemWidth(plainText: string): number {
  return Math.max(1, plainText.length) * AVG_CHAR_PX + ITEM_PADDING_PX;
}

/** At least 1; ceil(barWidth / itemWidth) otherwise. Zero / NaN widths (unmeasured) give 1. */
export function repeatsToCover(barWidth: number, itemWidth: number): number {
  if (!Number.isFinite(barWidth) || !Number.isFinite(itemWidth) || barWidth <= 0 || itemWidth <= 0) return 1;
  return Math.max(1, Math.ceil(barWidth / itemWidth));
}

/** The count used for the server render and the first client render. */
export function initialRepeats(plainText: string): number {
  return Math.min(128, repeatsToCover(ASSUMED_BAR_WIDTH_PX, estimateItemWidth(plainText)));
}

// --- Scroll speed -------------------------------------------------------------------------
// The marquee moves at a CONSTANT pixels-per-second, whatever the text length or bar width.
// (It used to be a fixed 18 s per loop, so a longer message or a wider bar travelled faster.)
// A merchant may set marqueeSpeed; null / absent / not-a-number = the default. The bounds are
// the ones the backend enforces (backend/src/themes/constants.ts): change all three together.
export const MARQUEE_SPEED_MIN = 10;
export const MARQUEE_SPEED_MAX = 200;
export const MARQUEE_SPEED_DEFAULT = 40;

export function resolveMarqueeSpeed(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return MARQUEE_SPEED_DEFAULT;
  return Math.min(MARQUEE_SPEED_MAX, Math.max(MARQUEE_SPEED_MIN, value));
}

/** Seconds for the track to travel one half (the loop length) at `speedPxPerSec`. */
export function marqueeDurationSeconds(halfWidthPx: number, speedPxPerSec: number): number {
  const speed = resolveMarqueeSpeed(speedPxPerSec);
  if (!Number.isFinite(halfWidthPx) || halfWidthPx <= 0) return 0;
  return halfWidthPx / speed;
}
