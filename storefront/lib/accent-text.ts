import { contrastBetween } from "./color-contrast";

// `text-accent-text`: the accent colour as TEXT. The brand accent is picked for buttons (it carries its own
// readable label), so as text on the page it is often too light: Heritage's gold is 2.9:1 on its cream,
// Market's pink 3.9:1, Requital's default teal 3.7:1 on white. This returns the accent itself when it already
// reads (4.5:1, WCAG AA for normal text) and otherwise the nearest shade of the same hue that does: darker on
// a light background, lighter on a dark one. Pure, hex in and hex out; anything else comes back unchanged.
export const ACCENT_TEXT_MIN_CONTRAST = 4.5;

function hexToHsl(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h /= 6;
  return [h, s, l];
}

function hslToHex(h: number, s: number, l: number): string {
  const f = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = f(p, q, h + 1 / 3);
    g = f(p, q, h);
    b = f(p, q, h - 1 / 3);
  }
  const hx = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${hx(r)}${hx(g)}${hx(b)}`;
}

export function resolveAccentText(accent: string, background: string): string {
  const base = contrastBetween(accent, background);
  const hsl = hexToHsl(accent);
  // Unknown colours (a keyword, rgb()) are left alone rather than guessed at.
  if (base === null || !hsl) return accent;
  if (base >= ACCENT_TEXT_MIN_CONTRAST) return accent;
  const bg = hexToHsl(background);
  const lighten = !!bg && bg[2] < 0.5;
  const [h, s, l] = hsl;
  for (let step = 1; step <= 100; step++) {
    const nl = lighten ? Math.min(1, l + step / 100) : Math.max(0, l - step / 100);
    const candidate = hslToHex(h, s, nl);
    const c = contrastBetween(candidate, background);
    if (c !== null && c >= ACCENT_TEXT_MIN_CONTRAST) return candidate;
  }
  // The background itself is too close to black or white for any shade to clear the bar.
  return lighten ? "#ffffff" : "#000000";
}
