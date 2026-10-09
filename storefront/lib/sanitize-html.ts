import DOMPurify from "dompurify";
import { sanitizeStyleAttribute } from "./sanitize-style";
import { sanitizeHtmlOnServer } from "./sanitize-html-server";

// Re-exported: callers and tests import it from here.
export { sanitizeStyleAttribute };

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

// Escape ONLY a "<" that opens a tag-like run which never closes — e.g. the
// "<from AED 20" in a legacy plain-text heading "Prices <from AED 20".
// Left as-is, the HTML parser opens a tag at "<from", never finds its ">",
// and silently drops everything from the "<" to end-of-string, so the
// heading just vanishes after the "<". This is the only lossy case:
//   - "<" + digit / whitespace / EOF ("< AED", "<100")  -> handed through;
//     DOMPurify escapes it and keeps the content already.
//   - "<" + letter/"/" that IS terminated by ">" before the next "<"
//     ("<b>", "<script>…</script>", "<img …/>") -> handed through so
//     DOMPurify keeps allowed tags and strips the rest, exactly as today
//     (malicious payloads still get dropped, not shown as text).
//   - "<" + letter/"/" that is NOT terminated -> escaped, so the words
//     survive.
// Runs before DOMPurify, which still sanitises the result — not a security
// relaxation, purely a "don't eat the merchant's words" guard.
export function escapeStrayLt(html: string): string {
  if (html.indexOf("<") === -1) return html;
  let out = "";
  for (let i = 0; i < html.length; i++) {
    if (html[i] !== "<") {
      out += html[i];
      continue;
    }
    const next = html[i + 1];
    const tagLike = next !== undefined && /[a-zA-Z/]/.test(next);
    if (!tagLike) {
      out += "<";
      continue;
    }
    const rest = html.slice(i);
    const gt = rest.indexOf(">");
    const nextLt = rest.indexOf("<", 1);
    const terminated = gt !== -1 && (nextLt === -1 || gt < nextLt);
    out += terminated ? "<" : "&lt;";
  }
  return out;
}

export function sanitizeDescriptionHtml(html: string): string {
  // The server render (these components are server-rendered now) has no DOM for DOMPurify
  // to run in; it uses a tokenise-and-rebuild allowlist with the same tags, the same href
  // rule and the same style allowlist. The server's output is the markup the page keeps
  // after hydration, so it must be as strict as the browser's, not just a placeholder.
  if (typeof window === "undefined") return sanitizeHtmlOnServer(escapeStrayLt(html));
  ensureStyleHook();
  return DOMPurify.sanitize(escapeStrayLt(html), { ALLOWED_TAGS, ALLOWED_ATTR });
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
