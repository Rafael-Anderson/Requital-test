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
// WHAT THE SECRET GRANTS: a different throttle bucket, nothing else. It is not
// authentication, never sets a user or tenant, never skips a guard. A leaked
// secret lets its holder choose which bucket their requests count against.
// Replay inside the skew window is harmless for the same reason.
//
// Unset secret = nothing is ever verified = the pre-existing behaviour (fail
// closed). Verification is constant time even for malformed input: the HMAC is
// always computed and compared, and the outcome is only combined at the end.

export const INTERNAL_AUTH_HEADER = 'x-internal-auth';
export const INTERNAL_CLIENT_IP_HEADER = 'x-internal-client-ip';
export const INTERNAL_AUTH_SKEW_SECONDS = 60;
const MAX_PATH_KEY = 200;

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
  const expected = hmacSha256Hex(secret, `${method.toUpperCase()}\n${path}\n${t}`);
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
  const secret = process.env.INTERNAL_API_SECRET;
  if (!secret) return null;
  const path = (req.originalUrl ?? req.url ?? '').split('?')[0];
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
