import { tieredCookieName } from '../common/cookies';
import { createTierCsrf } from '../common/csrf';

// Session-cookie migration (security audit finding #1), phase 3 — see
// CLAUDE.md's "Session-cookie migration, phase 3 of 3" note. One cookie
// NAME shared across every shop (not per-shop), scoped apart by cookie
// PATH instead — every customer-facing route already lives under
// /public/:shopSlug/..., so a browser only ever attaches the one matching
// shop's cookie to a given request; two shops' sessions coexist in the same
// browser as two distinct cookies (same name, different Path), the same way
// today's per-key localStorage already isolates them. The Path is only
// known per-request (it has the shopSlug in it), so — unlike the staff/
// platform tiers, which have one fixed Path for the whole app's lifetime —
// callers build it fresh per issue() call via customerCookiePath(shopSlug)
// rather than baking one in here.
export const CUSTOMER_ACCESS_COOKIE = tieredCookieName('req-customer-at');
export const CUSTOMER_REFRESH_COOKIE = tieredCookieName('req-customer-rt');

export function customerAccessPath(shopSlug: string): string {
  return `/public/${shopSlug}`;
}

export function customerRefreshPath(shopSlug: string): string {
  return `/public/${shopSlug}/auth/refresh`;
}

// path is a placeholder — every real cookie-setting call site overrides it
// per-shop via createTierCsrf's own cookiePath param on issue(), and every
// CSRF-checking request naturally only ever carries the one shop's cookie
// the browser already scoped by Path, so this factory's own static `path`
// is never actually relied on for the CSRF cookie itself.
export const customerCsrf = createTierCsrf({
  cookieBaseName: 'req-customer-csrf',
  accessCookieName: CUSTOMER_ACCESS_COOKIE,
  path: '/public',
  skipIfNoAccessCookie: true,
  // Same defense-in-depth reasoning as staffCsrf's own skipPathPrefixes —
  // a customer session cookie should never coincide with a platform-admin
  // request in practice, but excluding it costs nothing and keeps every
  // tier's global CSRF middleware consistent.
  skipPathPrefixes: ['/platform-admin', '/platform-auth'],
});
