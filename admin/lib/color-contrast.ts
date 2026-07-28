// WCAG relative-luminance/contrast-ratio math — duplicated (not shared via
// a package) in both admin/lib and storefront/lib since this is a 3-app
// workspace (backend/admin/storefront) with no shared package between the
// two Next.js apps; the storefront needs the identical logic at render time
// to pick --color-accent-foreground, so the two copies must stay in sync by
// hand if this ever changes.

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const n = parseInt(match[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function relativeLuminance([r, g, b]: [number, number, number]): number {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
}

function contrastRatio(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

// WCAG's threshold for large text / UI components (buttons, borders) — the
// same bar Requital's own teal accent (#069494, ~3.70:1 against white) was
// already validated against when the teal accent was first added. Prefer
// white as long as it clears this, rather than always picking whichever of
// white/black has the mathematically higher contrast: strict "always pick
// the winner" would flip teal itself to black text (black hits ~5.67:1
// against teal, edging out white's 3.70:1), which would look inconsistent
// with every other bg-accent/text-white surface in the app. Only fall back
// to near-black once white's contrast genuinely fails this bar — a
// near-white primary color, the actual unreadable case this exists to catch.
const WCAG_UI_COMPONENT_THRESHOLD = 3;

export function getReadableTextColor(hex: string | null | undefined): "#ffffff" | "#0a0a0a" {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return "#ffffff";
  const l = relativeLuminance(rgb);
  const contrastWithWhite = contrastRatio(l, 1);
  if (contrastWithWhite >= WCAG_UI_COMPONENT_THRESHOLD) return "#ffffff";
  const contrastWithBlack = contrastRatio(l, 0);
  return contrastWithBlack > contrastWithWhite ? "#0a0a0a" : "#ffffff";
}

// The best achievable contrast ratio against this background, using
// whichever text color (white or near-black) wins — WCAG AA for normal
// text is 4.5:1; below that, warn the merchant rather than silently
// shipping unreadable button/link text.
export function bestContrastRatio(hex: string | null | undefined): number | null {
  const rgb = hex ? hexToRgb(hex) : null;
  if (!rgb) return null;
  const l = relativeLuminance(rgb);
  return Math.max(contrastRatio(l, 1), contrastRatio(l, 0));
}

// NOT the WCAG AA normal-text bar (4.5:1) — the best of {white, black} text
// against ANY background color is mathematically guaranteed to be >=4.58:1
// (the two contrast curves cross at that value), so a 4.5 threshold here
// could never fire for any input; caught by color-contrast.test.ts trying
// to assert a warning on a near-white color and getting null back. Using
// the stricter AAA normal-text bar (7:1) instead, since that's the only
// threshold the guaranteed minimum can actually fall short of, and worded
// as "borderline" rather than "hard to read" — getReadableTextColor already
// guarantees a genuinely unreadable choice can't happen.
const WCAG_AAA_NORMAL_TEXT = 7;

export function getContrastWarning(hex: string | null | undefined): string | null {
  const ratio = bestContrastRatio(hex);
  if (ratio === null || ratio >= WCAG_AAA_NORMAL_TEXT) return null;
  return `This color has borderline contrast (${ratio.toFixed(1)}:1) — buttons and large text stay readable, but avoid it for small body text. Consider a darker or more saturated shade for stronger contrast.`;
}
