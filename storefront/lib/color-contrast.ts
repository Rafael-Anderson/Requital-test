// WCAG relative-luminance/contrast-ratio math — duplicated from
// admin/lib/color-contrast.ts (not shared via a package; this is a 3-app
// workspace with no shared package between admin and storefront). Keep the
// two in sync by hand if this logic ever changes. The storefront only needs
// the text-color picker, not the merchant-facing contrast-warning message
// admin's copy also has.

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

// WCAG's threshold for large text / UI components — the same bar
// Requital's teal (#069494, ~3.70:1 against white) was already validated
// against. Prefer white as long as it clears this, rather than always
// picking whichever of white/black has the mathematically higher contrast
// — strict "always pick the winner" would flip teal itself to black text
// (black edges out white here: ~5.67:1 vs 3.70:1), inconsistent with every
// other bg-accent/text-accent-foreground surface. Only fall back to
// near-black once white's contrast genuinely fails this bar — a near-white
// primary color, the actual unreadable case this exists to catch.
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
