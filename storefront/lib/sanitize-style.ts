// Shared by the browser sanitiser (sanitize-html.ts, DOMPurify) and the server one
// (sanitize-html-server.ts): the one definition of which inline styles may survive.

// The ONLY CSS properties that may appear in a `style` attribute, each with
// a strict value pattern. Anything else — position, display, background,
// url(), expression(), behavior, -moz-binding, negative margins, … — is
// dropped. This is the load-bearing part of allowing `style` at all.
const STYLE_PROP_VALUE: Record<string, RegExp> = {
  // #rgb / #rrggbb / #rrggbbaa, rgb()/rgba(), or a bare colour keyword.
  color:
    /^#[0-9a-f]{3}$|^#[0-9a-f]{6}$|^#[0-9a-f]{8}$|^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$|^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*(?:0|1|0?\.\d{1,3})\s*\)$|^[a-z]{3,20}$/i,
  "font-size": /^\d{1,3}(?:\.\d{1,2})?(?:px|rem|em|%)$/i,
  // Word chars, spaces, quotes, commas, hyphens only — enough for
  // `'Playfair Display', serif` / `Georgia, serif`, but no (), <, >, :, ;, /.
  "font-family": /^[\w\s"',-]{1,120}$/,
  "text-align": /^(?:left|right|center|justify)$/i,
};

// Exported for direct unit testing — the security-critical bit.
export function sanitizeStyleAttribute(raw: string): string {
  const kept: string[] = [];
  for (const decl of raw.split(";")) {
    const colon = decl.indexOf(":");
    if (colon === -1) continue;
    const prop = decl.slice(0, colon).trim().toLowerCase();
    const value = decl.slice(colon + 1).trim();
    const pattern = STYLE_PROP_VALUE[prop];
    if (!pattern) continue;
    // Belt-and-braces: reject anything that could smuggle a payload even
    // if a future pattern edit is too loose.
    if (/[<>\\]|url\(|expression|javascript:|\/\*|@import/i.test(value)) continue;
    if (!pattern.test(value)) continue;
    kept.push(`${prop}: ${value}`);
  }
  return kept.join("; ");
}
