import { randomBytes } from 'crypto';

// The magic link's secret: 32 random bytes (256 bits), base64url, 43 characters.
//
// WHY AN OPAQUE RANDOM SECRET AND NOT A SIGNED JWT. A JWT needs a signing secret
// (another env var to provision, rotate and leak) and still needs a row to be
// revocable, so the row would exist anyway. With an opaque secret the row IS the
// credential: only its SHA-256 is stored (a database read alone cannot mint a
// link), revoking is a column write, expiry is a column compare, and there is no
// key to confuse with the staff/customer/platform signing secrets. A random
// 256-bit value cannot be guessed, so the plain SHA-256 (no slow hash) is right.
export function newLinkToken(): string {
  return randomBytes(32).toString('base64url');
}

// Exactly what newLinkToken() emits. Anything else is rejected before a query.
export const LINK_TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

// A link lives at most this long. A delivery day is shorter; re-issuing is one
// click, and a stolen link is useless by the next morning.
export const LINK_TTL_HOURS = 12;

export function driverLinkUrl(token: string): string {
  const base = (process.env.ADMIN_URL ?? 'http://localhost:3001').replace(
    /\/+$/,
    '',
  );
  return `${base}/driver/${token}`;
}
