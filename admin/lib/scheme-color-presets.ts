import type { ColorScheme } from "./types";

// Flattens the theme's colour schemes into a de-duplicated swatch list for
// ColorPicker's "Theme colors" preset row — so "make this text my brand
// colour" is one click in the rich-text toolbar. Order: each scheme's
// background / text / button / button label, first occurrence wins the
// label. Capped at 16 (two rows of 8 in the picker grid).
const HEX_RE = /^#[0-9a-f]{6}$/i;

export function schemeColorPresets(schemes: ColorScheme[] | undefined): { label: string; value: string }[] {
  const out: { label: string; value: string }[] = [];
  const seen = new Set<string>();
  for (const scheme of schemes ?? []) {
    const roles: [string, string | undefined][] = [
      ["background", scheme.background],
      ["text", scheme.text],
      ["button", scheme.button],
      ["button label", scheme.buttonLabel],
    ];
    for (const [role, raw] of roles) {
      if (!raw || !HEX_RE.test(raw)) continue;
      const key = raw.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ label: `${scheme.name} ${role}`, value: raw });
      if (out.length >= 16) return out;
    }
  }
  return out;
}
