import { isIP } from 'net';
import { hmacSha256Hex, safeEqualHex } from '../channels/hmac';
import { throttleKey } from './client-ip';

// F10: the storefront's Next server calls this API for host resolution, SSR and
// the redirect map from 127.0.0.1, so without help all of that traffic shares
// one per-route throttle bucket. When INTERNAL_API_SECRET is set on both apps
// the storefront signs those calls: `X-Internal-Auth: t=<unix>,sig=<hex>` with
// sig = HMAC_SHA256(secret, METHOD "\n" PATH "\n" t), and a verified caller gets
// ITS OWN throttle bucket (ClientIpThrottlerGuard).
//
// WHAT THE SECRET GRANTS: a different throttle bucket, and ONLY on GET requests
// to the read-only public routes in INTERNAL_BUCKET_ROUTES. It is not
// authentication, never sets a user or tenant, never skips a guard. Everything
// else (auth, signup, password reset, every POST, discount and gift-card
// validation, order and survey lookups, geocoding, delivery quotes) uses the
// normal client-IP bucket even when the header verifies, because a holder who
// could choose their bucket there could rotate it and defeat the per-IP limit.
// On the allowlisted routes a holder is effectively exempt from the per-IP
// limit (they can pick the bucket); those routes are public and read-only.
// Replay inside the skew window is harmless for the same reason.
//
// Unset secret = nothing is ever verified = the pre-existing behaviour (fail
// closed). Verification is constant time even for malformed input: the HMAC is
// always computed and compared, and the outcome is only combined at the end.

export const INTERNAL_AUTH_HEADER = 'x-internal-auth';
export const INTERNAL_CLIENT_IP_HEADER = 'x-internal-client-ip';
export const INTERNAL_AUTH_SKEW_SECONDS = 60;
const MAX_PATH_KEY = 200;

// Read-only public routes the storefront server itself calls (host lookup, SSR
// shop/theme/catalog reads, redirect map, sitemap). A reserved first segment
// (orders, surveys, shops, abandoned-carts) is never a shop slug here, so the
// token-lookup routes under them stay on the IP bucket.
const SLUG_READS =
  'collections|regions|brands|homepage-templates|menu|theme-config|reviews/featured|bio-links|bio-page-config|templates|products|outlets|policy-pages|discounts/auto|redirects/map';
const INTERNAL_BUCKET_ROUTES = new RegExp(
  `^(?:/domains/resolve|/public/shops/sitemap|/public/(?!(?:orders|surveys|shops|abandoned-carts)(?:/|$))[^/]+(?:/(?:${SLUG_READS})(?:/[^/]+){0,3})?)$`,
);

export function isInternalBucketRoute(method: string, path: string): boolean {
  return method.toUpperCase() === 'GET' && INTERNAL_BUCKET_ROUTES.test(path);
}

const FORMAT = /^t=(\d{1,12}),sig=([0-9a-f]{64})$/i;
const ZERO_SIG = '0'.repeat(64);

function firstValue(v: string | string[] | undefined): string | undefined {
  return Array.isArray(v) ? v[0] : v;
}

export function verifyInternalAuth(
  secret: string | undefined,
  method: string,
  path: string,
  header: string | undefined,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  if (!secret) return false;
  const m = FORMAT.exec(header ?? '');
  const t = m ? m[1] : '0';
  const sig = m ? m[2] : ZERO_SIG;
  const expected = hmacSha256Hex(
    secret,
    `${method.toUpperCase()}\n${path}\n${t}`,
  );
  const sigOk = safeEqualHex(expected, sig);
  const fresh = Math.abs(nowSeconds - Number(t)) <= INTERNAL_AUTH_SKEW_SECONDS;
  return m !== null && sigOk && fresh;
}

// The throttle tracker for a request, or null when it is not a verified
// internal call (the guard then uses the client-IP bucket as before). A
// verified call with a valid forwarded client address (one Caddy wrote, only
// believed because the signature checked out) gets that visitor's own bucket;
// without one it is bucketed by the signed path, so server-side reads for one
// shop and route never share a bucket with another shop's.
export function internalThrottleTracker(req: {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
}): string | null {
  // Trimmed exactly as the storefront trims it, so stray whitespace in one env
  // file cannot make every signature fail.
  const secret = process.env.INTERNAL_API_SECRET?.trim();
  if (!secret) return null;
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
  if (!isInternalBucketRoute(req.method ?? 'GET', path)) return null;
  const ok = verifyInternalAuth(
    secret,
    req.method ?? 'GET',
    path,
    firstValue(req.headers[INTERNAL_AUTH_HEADER]),
  );
  if (!ok) return null;
  const ip = firstValue(req.headers[INTERNAL_CLIENT_IP_HEADER])?.trim();
  if (ip && isIP(ip)) return `internal:ip:${throttleKey(ip)}`;
  return `internal:path:${path.slice(0, MAX_PATH_KEY)}`;
}
