// Server-render allowlist sanitiser for the storefront's admin-authored HTML.
// DOMPurify needs a DOM, and the server render has none, so on the server
// sanitizeDescriptionHtml (sanitize-html.ts) uses this instead. It does not clean the
// input: it TOKENISES it and REBUILDS the output from scratch. Every tag in the output is
// written by this file from the allowlist, with attributes this file chose and escaped;
// anything not recognised as an allowed tag is text, and all text has `<` and `>`
// escaped, so input can never come through as markup. It also guarantees balance: a
// closing tag is only emitted for a tag this file opened, and everything still open is
// closed at the end, so authored HTML can never close an element of the page around it.
//
// The server's markup is what the page KEEPS after hydration (React does not re-apply an
// unchanged innerHTML), so this is a real security boundary, not a placeholder.
//
// ALLOWLIST: identical to sanitize-html.ts (tags, `href`, the style allowlist in
// sanitize-style.ts) and a port of backend/src/common/sanitize-html.ts, which the Shopify
// importer already runs on 30k hostile payloads. The apps share no code, so change the
// allowlists together.
import { sanitizeStyleAttribute } from "./sanitize-style";

const ALLOWED_TAGS: ReadonlySet<string> = new Set([
  'p',
  'div',
  'br',
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'ul',
  'ol',
  'li',
  'a',
  'span',
]);
const VOID_TAGS: ReadonlySet<string> = new Set(['br']);

// Tags whose CONTENT is dropped with them (the content is code or not prose).
// Any other disallowed tag is dropped but its text content is kept.
const DROP_WITH_CONTENT: ReadonlySet<string> = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'noscript',
  'template',
  'textarea',
  'title',
  'svg',
  'math',
  'head',
  'xmp',
  'plaintext',
  'noembed',
  'noframes',
  'applet',
  'frameset',
  'frame',
  'select',
  'button',
  'canvas',
  'audio',
  'video',
  'form',
]);

const MAX_DEPTH = 100;
const MAX_HREF_LENGTH = 2000;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  colon: ':',
  tab: '\t',
  newline: '\n',
  nbsp: ' ',
};

// Decodes the entities a browser would decode inside an attribute value, so
// the value is validated in the form the browser will actually use.
function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#\d+|[a-z]+);/gi,
    (match, body: string) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code > 0x10ffff) return '';
        try {
          return String.fromCodePoint(code);
        } catch {
          return '';
        }
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? match;
    },
  );
}

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeText(text: string): string {
  return (
    text
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
  );
}

// An allowed href is an http(s)/mailto/tel URL or a relative one. Whitespace
// and control characters are removed first because browsers ignore them inside
// a scheme ("java\tscript:"), so the check must see what the browser will see.
function safeHref(raw: string): string | null {
  const compact = decodeEntities(raw).replace(/[\x00-\x20\x7f-\x9f]/g, '');
  if (!compact || compact.length > MAX_HREF_LENGTH) return null;
  if (/^(https?:|mailto:|tel:)/i.test(compact)) return compact;
  // Anything else with a colon before the first '/', '?' or '#' is a scheme
  // (javascript:, data:, vbscript:, or an odd one with a leading junk character
  // that a browser would still not treat as a relative path): refused.
  if (/^[^/?#]*:/.test(compact)) return null;
  // A "//host" or "\\host" start is a host, not a relative path: refuse it.
  if (/^[\\/]{2}/.test(compact) || compact.includes('\\')) return null;
  return compact;
}

interface ParsedTag {
  closing: boolean;
  name: string;
  attrs: Map<string, string>;
  end: number; // index just past the '>'
}

// Parses one tag starting at html[start] === '<'. Null when it is not a
// well-formed tag (the caller then treats the '<' as text).
function parseTag(html: string, start: number): ParsedTag | null {
  const head = /^<(\/?)([a-zA-Z][a-zA-Z0-9:-]*)/.exec(
    html.slice(start, start + 64),
  );
  if (!head) return null;
  const closing = head[1] === '/';
  const name = head[2].toLowerCase();
  let i = start + head[0].length;
  const attrs = new Map<string, string>();
  for (;;) {
    while (i < html.length && /[\s/]/.test(html[i])) i += 1;
    if (i >= html.length) return null;
    if (html[i] === '>') return { closing, name, attrs, end: i + 1 };
    const attrName = /^[^\s"'<>/=]+/.exec(html.slice(i, i + 200));
    if (!attrName) {
      // A stray quote or '<' inside the tag: not a tag we can trust.
      return null;
    }
    i += attrName[0].length;
    while (i < html.length && /\s/.test(html[i])) i += 1;
    let value = '';
    if (html[i] === '=') {
      i += 1;
      while (i < html.length && /\s/.test(html[i])) i += 1;
      const quote = html[i];
      if (quote === '"' || quote === "'") {
        const close = html.indexOf(quote, i + 1);
        if (close === -1) return null;
        value = html.slice(i + 1, close);
        i = close + 1;
      } else {
        const bare = /^[^\s>]*/.exec(html.slice(i, i + 4000));
        value = bare ? bare[0] : '';
        i += value.length;
      }
    }
    const key = attrName[0].toLowerCase();
    if (!attrs.has(key)) attrs.set(key, value);
  }
}

export function sanitizeHtmlOnServer(input: string): string {
  const stack: string[] = [];
  let out = '';
  let i = 0;

  while (i < input.length) {
    const lt = input.indexOf('<', i);
    if (lt === -1) {
      out += escapeText(input.slice(i));
      break;
    }
    out += escapeText(input.slice(i, lt));

    if (input.startsWith('<!--', lt)) {
      const end = input.indexOf('-->', lt + 4);
      i = end === -1 ? input.length : end + 3;
      continue;
    }
    if (input[lt + 1] === '!' || input[lt + 1] === '?') {
      const end = input.indexOf('>', lt);
      i = end === -1 ? input.length : end + 1;
      continue;
    }

    const tag = parseTag(input, lt);
    if (!tag) {
      out += '&lt;';
      i = lt + 1;
      continue;
    }
    i = tag.end;

    if (tag.closing) {
      const at = stack.lastIndexOf(tag.name);
      if (ALLOWED_TAGS.has(tag.name) && !VOID_TAGS.has(tag.name) && at !== -1) {
        while (stack.length > at) out += `</${stack.pop()}>`;
      }
      continue;
    }

    if (DROP_WITH_CONTENT.has(tag.name)) {
      const close = new RegExp(`</${tag.name}(?=[\\s/>])`, 'i');
      const rest = input.slice(i);
      const found = close.exec(rest);
      if (!found) {
        i = input.length;
      } else {
        const gt = input.indexOf('>', i + found.index);
        i = gt === -1 ? input.length : gt + 1;
      }
      continue;
    }

    if (!ALLOWED_TAGS.has(tag.name)) {
      continue;
    }

    if (!VOID_TAGS.has(tag.name) && stack.length >= MAX_DEPTH) continue;

    let attrText = '';
    if (tag.name === 'a') {
      const href = tag.attrs.get('href');
      const safe = href === undefined ? null : safeHref(href);
      if (safe) attrText += ` href="${escapeAttr(safe)}"`;
    }
    const style = tag.attrs.get('style');
    if (style !== undefined) {
      const cleaned = sanitizeStyleAttribute(decodeEntities(style));
      if (cleaned) attrText += ` style="${escapeAttr(cleaned)}"`;
    }
    out += `<${tag.name}${attrText}>`;
    if (!VOID_TAGS.has(tag.name)) stack.push(tag.name);
  }

  while (stack.length > 0) out += `</${stack.pop()}>`;
  return out;
}
