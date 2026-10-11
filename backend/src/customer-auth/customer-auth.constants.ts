import type { NextFunction, Request, Response } from 'express';
import { pathScopedCookieName, tieredCookieName } from '../common/cookies';
import { createTierCsrf, type TierCsrf } from '../common/csrf';

// Customer cookies live at Path=/ with the SHOP SLUG IN THE COOKIE NAME
// (`__Host-req-customer-at-<slug>`), and the backend picks the cookie by the
// slug in the request URL. They used to be one shared name scoped apart by
// Path=/public/<slug>, which never worked in a browser: the storefront calls
// the API as the same-origin `/api/public/<slug>/...` (next.config.ts rewrite),
// a URL the Path never matches, so the browser stored the cookies and then
// never sent them back (login, wishlist and store credit all behaved signed
// out). The backend cannot know the proxy mount, so any Path other than `/`
// is either wrong for the proxied call or for a direct one.
//
// Two shops in one browser still coexist (one cookie set per slug), a
// `__Host-` prefix is now legal and used in production (Secure, no Domain,
// Path=/: a sibling subdomain cannot shadow it, which the old `__Secure-`
// sub-path cookies allowed), and SameSite=Strict is unchanged. Costs: three
// cookies per shop signed in to, sent to every request on the origin
// (httpOnly, same origin), the refresh token included.
const SLUG_RE = /^[a-z0-9-]{1,63}$/;

export interface CustomerCookieNames {
  access: string;
  refresh: string;
  csrf: string;
}

// null for anything that is not a possible shop slug (the cookie name is built
// from it, and an invalid name makes res.cookie throw). Case-folded so
// /public/Shop-A and /public/shop-a address the same cookies.
export function customerCookieNames(
  shopSlug: unknown,
): CustomerCookieNames | null {
  if (typeof shopSlug !== 'string') return null;
  const slug = shopSlug.toLowerCase();
  if (!SLUG_RE.test(slug)) return null;
  return {
    access: tieredCookieName(`req-customer-at-${slug}`),
    refresh: tieredCookieName(`req-customer-rt-${slug}`),
    csrf: tieredCookieName(`req-customer-csrf-${slug}`),
  };
}

export const CUSTOMER_COOKIE_PATH = '/';

// Cookies set before 2026-10-12 (shared name, Path=/public/<slug>). The browser
// never sent them back through the proxy and nothing reads them now; logout
// just expires them so they do not linger. Remove once they cannot exist.
export function legacyCustomerCookies(
  shopSlug: string,
): { name: string; path: string }[] {
  return [
    {
      name: pathScopedCookieName('req-customer-at'),
      path: `/public/${shopSlug}`,
    },
    {
      name: pathScopedCookieName('req-customer-rt'),
      path: `/public/${shopSlug}/auth/refresh`,
    },
    {
      name: pathScopedCookieName('req-customer-csrf'),
      path: `/public/${shopSlug}`,
    },
  ];
}

// Bounds the access cookie's client-side lifetime to the JWT's own (15m,
// see CustomerAuthService's ACCESS_TOKEN_LIFETIME) so a dead-JWT cookie
// can't linger in the jar and keep customerCsrf's skipIfNoAccessCookie
// from skipping on a cold re-login. See common/cookies.ts.
export const CUSTOMER_ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000;

// One CSRF instance per shop slug, because the CSRF cookie name carries the
// slug too (a single shared cookie would be overwritten by the other shop's
// login in the same browser and fail the double-submit check). Memoised, and
// capped: slugs in the URL are attacker-chosen until they match a cookie.
const csrfBySlug = new Map<string, TierCsrf>();
function csrfFor(shopSlug: unknown): TierCsrf | null {
  const names = customerCookieNames(shopSlug);
  if (!names) return null;
  let csrf = csrfBySlug.get(names.csrf);
  if (!csrf) {
    if (csrfBySlug.size >= 500) csrfBySlug.clear();
    csrf = createTierCsrf({
      cookieBaseName: names.csrf.replace(/^__Host-/, ''),
      accessCookieName: names.access,
      path: CUSTOMER_COOKIE_PATH,
      skipIfNoAccessCookie: true,
    });
    csrfBySlug.set(names.csrf, csrf);
  }
  return csrf;
}

// Every customer-facing route lives under /public/:shopSlug, so the shop is
// read from the URL (this runs as global middleware, before routing, so
// req.params is not there yet). Any other URL has no customer cookies to guard.
function slugFromUrl(req: Request): string | null {
  const m = /^\/public\/([^/?#]+)/.exec(req.originalUrl || req.url || '');
  return m ? m[1] : null;
}

export const customerCsrf = {
  doubleCsrfProtection(req: Request, res: Response, next: NextFunction) {
    const csrf = csrfFor(slugFromUrl(req));
    if (!csrf) return next();
    return csrf.doubleCsrfProtection(req, res, next);
  },
  // accessToken: the token the session identifier is bound to (the one in the
  // cookie, or the one just minted at login/refresh).
  issue(
    req: Request,
    res: Response,
    shopSlug: string,
    accessToken: string,
    opts?: { reuseExisting?: boolean },
  ) {
    csrfFor(shopSlug)?.issue(req, res, accessToken, opts);
  },
};
