import DOMPurify from "dompurify";

// This HTML is authored in the admin (product descriptions, policy pages,
// the theme builder's rich_text / image_text text blocks, collection-page
// text, additional-info blocks) and rendered on a PUBLIC storefront page.
// Sanitising here is what stops a compromised/malicious admin session — or
// an XSS bug in an admin editor itself — from becoming stored script that
// runs in every visitor's browser.
//
// The tag list matches what the admin editors can produce: the TipTap
// rich-text editor (bold/italic/underline/strike, h1–h6, bullet/numbered
// lists, links, and inline colour / font-size / font-family / alignment via
// `style`) plus the block-level tags contentEditable inserts (p/div/br/span).
const ALLOWED_TAGS = [
  "p", "div", "br", "b", "strong", "i", "em", "u", "s",
  "h1", "h2", "h3", "h4", "h5", "h6",
  "ul", "ol", "li", "a", "span",
];
// `style` is allowed but every declaration is filtered by
// sanitizeStyleAttribute below — only a narrow, per-property-validated
// allowlist survives (stakeholder #15/#16).
const ALLOWED_ATTR = ["href", "style"];

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

// The style-attribute hook is installed lazily on first sanitize, NOT at
// module load. `dompurify`'s default export is a ready instance only in a
// browser; imported into a Node/SSR module graph (which now happens — the
// theme header/footer/sections import this file) it's a bare factory with
// no `.addHook` / `.sanitize`, so a module-level `addHook(...)` throws at
// import time. Every real consumer is a client component, so the first
// actual sanitize call always runs in the browser where the instance is
// live; the module just has to *load* without touching DOMPurify.
let hookInstalled = false;
function ensureStyleHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;
  DOMPurify.addHook("uponSanitizeAttribute", (_node, data) => {
    if (data.attrName !== "style") return;
    data.attrValue = sanitizeStyleAttribute(data.attrValue);
    if (!data.attrValue) data.keepAttr = false;
  });
}

export function sanitizeDescriptionHtml(html: string): string {
  ensureStyleHook();
  return DOMPurify.sanitize(html, { ALLOWED_TAGS, ALLOWED_ATTR });
}

// Plain-text excerpt for contexts that can't render HTML (product card
// blurbs, meta descriptions) — strips tags rather than dumping raw markup
// as visible text.
export function stripHtmlToText(html: string): string {
  return html
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
