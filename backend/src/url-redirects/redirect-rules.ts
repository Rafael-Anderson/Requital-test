// Pure rules for the URL redirect map (ONB-4). No I/O: everything here is
// unit-tested directly, and the service/controllers only call it.
//
// THE SECURITY CONTRACT (this file is the open-redirect defence):
//   A redirect target is valid ONLY if it is
//     (a) a same-origin PATH: starts with exactly one '/', and cannot be
//         re-read by a browser as a host ('//host', '/\host', a tab or newline
//         smuggled in, a percent-encoded variant of any of those), or
//     (b) an absolute http(s) URL whose host is EXACTLY one of the shop's own
//         hosts (compared after the WHATWG URL parser has lowercased and
//         punycoded it), with no userinfo and no explicit port.
//   Anything else (javascript:, data:, protocol-relative, a lookalike host) is
//   refused. The same check runs on write AND again at resolve time against the
//   shop's CURRENT hosts, so a custom domain disconnected later stops being a
//   valid target without anyone editing the redirect.
//
// FROM-PATH POLICY (decisions, documented in docs/handoff via the final report):
//   * A from path is a PATH ONLY. A '?' or '#' is refused rather than silently
//     dropped, because "redirect /p?id=5" would otherwise quietly mean
//     "redirect every /p".
//   * Matching ignores the request's query string; the storefront proxy appends
//     the visitor's query string to a path target that has none of its own.
//   * Matching is case-insensitive (stored lowercased) and ignores a trailing
//     slash, so /Products/Rose/ and /products/rose are one entry.
//   * Each segment is percent-decoded then re-encoded, so '%D8%B9' and the raw
//     Arabic letter are one entry. A decoded '/', '\' or control character
//     inside a segment is refused.
//   * The storefront's own utility routes can never be a FROM (see
//     RESERVED_FROM_SEGMENTS), and neither can '/'.

export const MAX_REDIRECTS_PER_SHOP = 10_000;
export const MAX_FROM_LENGTH = 512; // matches the VARCHAR(512) column
export const MAX_TARGET_LENGTH = 2000;
export const MAX_CHAIN_HOPS = 3;

// First path segments owned by the storefront app or the platform, never
// available as a redirect source: redirecting them would break checkout/pay/
// account, static assets or the API proxy.
export const RESERVED_FROM_SEGMENTS: ReadonlySet<string> = new Set([
  '_next',
  'api',
  'admin',
  'store-not-found',
  'checkout',
  'cart',
  'account',
  'pay',
  'orders',
  'survey',
  'bio',
  'unsubscribe-notify',
  'sitemap.xml',
  'robots.txt',
  'favicon.ico',
  '.well-known',
]);

// C0 controls, DEL, and C1 controls.
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/;
// Anything a URL parser may strip or an eye cannot see: whitespace, line/para
// separators, zero-width and bidi controls, BOM.
const INVISIBLE_CHARS =
  /[\s\u00a0\u1680\u2000-\u200f\u2028-\u202f\u205f-\u206f\u3000\ufeff]/;

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

function fail<T>(error: string): Checked<T> {
  return { ok: false, error };
}

// Percent-decode + lowercase + re-encode each segment. Returns null when the
// path cannot be canonicalised safely. `pathOnly` must start with '/'.
function canonicalSegments(pathOnly: string): string | null {
  if (!pathOnly.startsWith('/')) return null;
  const segments = pathOnly.split('/').slice(1);
  const out: string[] = [];
  for (let i = 0; i < segments.length; i += 1) {
    const raw = segments[i];
    if (raw === '') {
      // A single trailing slash is dropped; any other empty segment ('//') is
      // not a path we will match or write.
      if (i === segments.length - 1 && i > 0) continue;
      if (segments.length === 1) continue; // the root '/'
      return null;
    }
    let decoded: string;
    try {
      decoded = decodeURIComponent(raw);
    } catch {
      return null;
    }
    // eslint-disable-next-line no-control-regex -- control characters are refused on purpose
    if (/[\u0000-\u001f\u007f\\/]/.test(decoded)) return null;
    if (decoded === '.' || decoded === '..') return null;
    out.push(encodeURIComponent(decoded.normalize('NFC').toLowerCase()));
  }
  return `/${out.join('/')}`;
}

// The form every lookup is made in. Used for the request path at resolve time
// (never throws; null means "cannot match anything").
export function canonicalizeRequestPath(pathname: string): string | null {
  if (typeof pathname !== 'string' || pathname.length > 4000) return null;
  const cut = pathname.split(/[?#]/, 1)[0];
  const canonical = canonicalSegments(cut);
  if (canonical === null || canonical.length > MAX_FROM_LENGTH) return null;
  return canonical;
}

// A source path an admin or a CSV supplies. Strict: see the policy above.
export function validateFromPath(raw: string): Checked<string> {
  if (typeof raw !== 'string') return fail('From path is required');
  const trimmed = raw.trim();
  if (!trimmed) return fail('From path is required');
  if (trimmed.length > 1000) return fail('From path is too long');
  if (CONTROL_CHARS.test(trimmed) || INVISIBLE_CHARS.test(trimmed)) {
    return fail('From path contains a space or control character');
  }
  if (!trimmed.startsWith('/')) return fail('From path must start with /');
  if (trimmed.startsWith('//')) return fail('From path must not start with //');
  if (/[?#]/.test(trimmed)) {
    return fail(
      'From path must not include a query string or fragment (matching is by path only)',
    );
  }
  if (trimmed.includes('\\'))
    return fail('From path must not contain a backslash');
  const canonical = canonicalSegments(trimmed);
  if (canonical === null) return fail('From path is not a valid path');
  if (canonical === '/') {
    return fail('The home page (/) cannot be a redirect source');
  }
  if (canonical.length > MAX_FROM_LENGTH) return fail('From path is too long');
  const first = decodeURIComponent(canonical.split('/')[1]);
  if (RESERVED_FROM_SEGMENTS.has(first)) {
    return fail(
      `/${first} is reserved by the storefront and cannot be redirected`,
    );
  }
  return { ok: true, value: canonical };
}

function normalizeHost(host: string): string | null {
  try {
    return new URL(`https://${host}`).hostname;
  } catch {
    return null;
  }
}

export interface ValidTarget {
  // What is stored and what the storefront is told to send the visitor to.
  value: string;
  kind: 'path' | 'absolute';
  // Canonical path component, for chain/loop analysis. Null for an absolute URL
  // that leaves the shop's own hosts (cannot happen: those are refused), kept
  // nullable for clarity.
  canonicalPath: string | null;
}

// `hosts` are the shop's OWN current hosts (shopOwnHosts()).
export function validateTarget(
  raw: string,
  hosts: readonly string[],
): Checked<ValidTarget> {
  if (typeof raw !== 'string') return fail('Target is required');
  const target = raw.trim();
  if (!target) return fail('Target is required');
  if (target.length > MAX_TARGET_LENGTH) return fail('Target is too long');
  if (CONTROL_CHARS.test(target) || INVISIBLE_CHARS.test(target)) {
    return fail(
      'Target must not contain spaces or control characters (encode them)',
    );
  }
  if (target.includes('\\')) return fail('Target must not contain a backslash');

  if (target.startsWith('/')) return validatePathTarget(target);
  if (/^https?:\/\//i.test(target))
    return validateAbsoluteTarget(target, hosts);
  return fail(
    "Target must be a path starting with / or an http(s) URL on this shop's own domain",
  );
}

function validatePathTarget(target: string): Checked<ValidTarget> {
  if (target.startsWith('//')) {
    return fail('Target must not start with // (that would leave the site)');
  }
  // Re-read after percent-decoding, up to three rounds, so '/%2Fevil.com',
  // '/%5Cevil.com' and double-encoded forms are all refused.
  let current = target;
  for (let round = 0; round < 3; round += 1) {
    let decoded: string;
    try {
      decoded = decodeURIComponent(current);
    } catch {
      if (round === 0) return fail('Target has a malformed percent-escape');
      break;
    }
    if (decoded === current) break;
    if (
      decoded.includes('\\') ||
      CONTROL_CHARS.test(decoded) ||
      INVISIBLE_CHARS.test(decoded.replace(/ /g, '')) || // an encoded space is legitimate
      decoded.startsWith('//')
    ) {
      return fail('Target contains an encoded character that is not allowed');
    }
    current = decoded;
  }
  // Belt and braces: the URL parser must still consider this the same origin.
  try {
    const probe = new URL(target, 'https://shop.invalid');
    if (probe.origin !== 'https://shop.invalid') {
      return fail('Target must be a path on this site');
    }
  } catch {
    return fail('Target is not a valid path');
  }
  const pathPart = target.split(/[?#]/, 1)[0];
  const canonicalPath = canonicalSegments(pathPart);
  if (canonicalPath === null) return fail('Target is not a valid path');
  return { ok: true, value: { value: target, kind: 'path', canonicalPath } };
}

function validateAbsoluteTarget(
  target: string,
  hosts: readonly string[],
): Checked<ValidTarget> {
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    return fail('Target is not a valid URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    return fail('Target must use http or https');
  }
  if (url.username || url.password) {
    return fail('Target must not contain credentials');
  }
  // The parser drops a default port (':443'), so check the raw authority too.
  const authority = target.replace(/^https?:\/\//i, '').split(/[/?#]/, 1)[0];
  if (url.port || /:\d*$/.test(authority)) {
    return fail('Target must not specify a port');
  }
  const own = hosts.map(normalizeHost).filter((h): h is string => h !== null);
  if (!own.includes(url.hostname)) {
    return fail("Target host is not this shop's own domain");
  }
  return {
    ok: true,
    value: {
      value: url.href,
      kind: 'absolute',
      canonicalPath: canonicalSegments(url.pathname),
    },
  };
}

export function validateStatusCode(value: unknown): Checked<301 | 302> {
  if (value === 301 || value === 302) return { ok: true, value };
  return fail('Status code must be 301 or 302');
}

export interface RedirectEntry {
  fromPath: string; // canonical
  toTarget: string;
  statusCode: number;
  active: boolean;
}

// Write-time loop / long-chain check for `fromPath -> target`, walking the
// existing active rows. Resolution itself is bounded to one extra hop whatever
// is stored (resolveRedirect), so this is guard-rails for the merchant, not the
// safety mechanism.
export function checkChain(
  fromPath: string,
  target: ValidTarget,
  existing: ReadonlyMap<string, RedirectEntry>,
  hosts: readonly string[],
): string | null {
  if (target.canonicalPath === fromPath) {
    return 'From and target are the same page';
  }
  let current = target.canonicalPath;
  let hops = 0;
  while (current !== null) {
    if (current === fromPath) return 'This redirect would create a loop';
    const next = existing.get(current);
    if (!next || !next.active) break;
    const checked = validateTarget(next.toTarget, hosts);
    if (!checked.ok) break;
    current = checked.value.canonicalPath;
    hops += 1;
    if (hops > MAX_CHAIN_HOPS) {
      return `This redirect would start a chain longer than ${MAX_CHAIN_HOPS} hops`;
    }
  }
  return null;
}

export interface ResolvedRedirect {
  to: string;
  status: 301 | 302;
}

// Resolve one canonical request path against a shop's entries. Every target is
// re-validated against the shop's CURRENT hosts. Follows at most ONE extra hop
// (a->b->c answers a->c) so a visitor is not bounced twice, and never answers a
// redirect back to the page asked for.
export function resolveRedirect(
  requestPath: string,
  entries: ReadonlyMap<string, RedirectEntry>,
  hosts: readonly string[],
): ResolvedRedirect | null {
  const first = entries.get(requestPath);
  if (!first || !first.active) return null;
  const firstTarget = validateTarget(first.toTarget, hosts);
  if (!firstTarget.ok) return null;
  if (firstTarget.value.canonicalPath === requestPath) return null;

  let to = firstTarget.value.value;
  let temporary = first.statusCode === 302;

  const nextKey = firstTarget.value.canonicalPath;
  const second = nextKey ? entries.get(nextKey) : undefined;
  if (second && second.active) {
    const secondTarget = validateTarget(second.toTarget, hosts);
    if (
      secondTarget.ok &&
      secondTarget.value.canonicalPath !== requestPath &&
      secondTarget.value.canonicalPath !== nextKey
    ) {
      to = secondTarget.value.value;
      temporary = temporary || second.statusCode === 302;
    }
  }
  return { to, status: temporary ? 302 : 301 };
}

// Normalises a 404-log path: canonical, capped, never a query string. Null
// means "do not log this".
export function normalizeNotFoundPath(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (!trimmed.startsWith('/') || trimmed.startsWith('//')) return null;
  if (CONTROL_CHARS.test(trimmed) || INVISIBLE_CHARS.test(trimmed)) return null;
  const canonical = canonicalizeRequestPath(trimmed);
  if (canonical === null || canonical === '/') return null;
  const first = decodeURIComponent(canonical.split('/')[1]);
  if (RESERVED_FROM_SEGMENTS.has(first)) return null;
  return canonical;
}

// A referrer reduced to its host: nothing but a hostname can be stored.
export function referrerHost(raw: string | undefined | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    const host = url.hostname.toLowerCase();
    return host && host.length <= 255 ? host : null;
  } catch {
    return null;
  }
}
