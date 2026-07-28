import DOMPurify from "dompurify";

// admin's RichTextEditor (admin/components/ui/RichTextEditor.tsx) is a
// contentEditable + document.execCommand editor with zero sanitization of
// its own — the tag set below is exactly what its toolbar can produce
// (bold/italic/underline, an h2 heading, bullet/numbered lists, links) plus
// the block-level tags contentEditable itself inserts (p/div/br/span). This
// is rendered on a PUBLIC storefront page, written by a merchant's admin
// account — sanitizing here is what stops a compromised/malicious admin
// session (or an XSS bug in the admin editor itself) from becoming a stored
// script that runs in every visitor's browser, not just an authenticated one.
const ALLOWED_TAGS = ["p", "div", "br", "b", "strong", "i", "em", "u", "h2", "ul", "ol", "li", "a", "span"];
const ALLOWED_ATTR = ["href"];

export function sanitizeDescriptionHtml(html: string): string {
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
