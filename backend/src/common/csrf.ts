import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response } from 'express';
import { csrfCookieOptions, tieredCookieName } from './cookies';

// Session-cookie migration (security audit finding #1) needs CSRF
// protection it didn't before: SameSite=Strict blocks classic cross-site
// forgery, but this platform has open self-signup, so an attacker can host
// arbitrary HTML on their own {shop}.requital.io — same-site with
// api.requital.io, so SameSite=Strict alone does not block a forged
// same-site request from there. Double-submit cookie pattern via csrf-csrf
// (the maintained successor to the deprecated `csurf`) closes that gap.
// One factory reused per token tier as each one migrates off localStorage
// (platform admin first) — every tier gets its own cookie name and its own
// getSessionIdentifier tied to that tier's own access-token cookie, so a
// CSRF token minted for one tier's session can never validate a request
// authenticated by a different tier's session cookie.
// Every response that carries a CSRF token exposes it under this response
// header — the one distribution channel that works uniformly across every
// tier and every hostname arrangement, unlike `document.cookie` (see this
// file's own top comment for the cross-origin gap that ruled that out).
// Frontends read it once (login/signup/refresh, and the "me"/bootstrap
// endpoint) and hold the value in memory for the rest of that page's
// lifetime — see main.ts's `exposedHeaders` CORS config, required for a
// custom response header to be readable by fetch() at all cross-origin.
export const CSRF_RESPONSE_HEADER = 'X-CSRF-Token';

export interface TierCsrf {
  doubleCsrfProtection: ReturnType<typeof doubleCsrf>['doubleCsrfProtection'];
  // Mints (or reuses) the CSRF cookie for the *current* response and sets
  // its value on the CSRF_RESPONSE_HEADER response header, so the frontend
  // can read it via fetch() regardless of which hostname served the page —
  // see this file's own top comment. Must be called after the tier's
  // access-token cookie has been written to `res` — pass that same access
  // token here so getSessionIdentifier can see it; csrf-csrf reads the
  // session identifier off `req`, not `res`, and at login/refresh time the
  // just-issued access token isn't on `req.cookies` yet (it only reflects
  // what the *incoming* request already had), so this patches `req.cookies`
  // in place before generating.
  //
  // cookiePath overrides the tier's own default cookie Path for this one
  // call — only the customer tier needs this (see customer-auth.constants.ts):
  // its CSRF cookie has to be scoped to /public/{shopSlug}, a value only
  // known at request time, not when the factory itself was constructed.
  //
  // reuseExisting (default false = always rotate) lets a "me"/bootstrap
  // endpoint hand the frontend its already-valid CSRF value back on a fresh
  // page load instead of forcing a rotation that would silently invalidate
  // the token any other already-open tab is still holding in memory.
  issue(
    req: Request,
    res: Response,
    accessToken: string,
    opts?: { cookiePath?: string; reuseExisting?: boolean },
  ): void;
}

export function createTierCsrf(opts: {
  cookieBaseName: string;
  accessCookieName: string;
  path: string;
  // Platform admin (phase 1) has a small, closed set of controllers, so its
  // CSRF middleware is scoped narrowly via forRoutes(prefix). Staff and
  // customer (phase 2/3) are guarded by the same cookie on essentially every
  // controller in the app — there's no closed prefix to scope forRoutes to.
  // Instead their CSRF middleware is applied globally (forRoutes('*')) and
  // skips itself whenever this tier's own access cookie isn't present on the
  // request at all: a request genuinely carrying this session's cookie is
  // exactly and only the case CSRF needs to guard (that's also what makes a
  // forged same-site request dangerous in the first place — the browser
  // auto-attaches the real cookie to it), so nothing is weakened by skipping
  // everything else (signup/login pre-session, webhooks with no cookie at
  // all, another tier's own cookie-carrying request).
  skipIfNoAccessCookie?: boolean;
  // Extra bypass on top of skipIfNoAccessCookie, checked first — real bug
  // found while wiring the staff tier's global CSRF (2026-08-27): a
  // platform admin who also happens to have their own separate merchant
  // login in the same browser would carry BOTH a platform cookie and a
  // staff cookie; POST /platform-admin/shops/:id/impersonate is
  // platform-CSRF-protected already (see platform-auth.constants.ts's
  // narrow forRoutes), but the staff tier's own global CSRF middleware would
  // ALSO see that admin's staff cookie present and demand a staff CSRF
  // header the platform-admin frontend never sends, 403ing a legitimate
  // impersonate call. Lets a tier opt a route prefix out entirely rather
  // than only reacting to its own cookie's presence.
  skipPathPrefixes?: string[];
}): TierCsrf {
  const { generateCsrfToken, doubleCsrfProtection } = doubleCsrf({
    getSecret: () => process.env.CSRF_SECRET!,
    // Ties the CSRF token's HMAC to the specific access token in play, so a
    // token minted for one login/rotation can't be replayed against a
    // different one — the "typically the session id or JWT" case the
    // library's own docs describe.
    getSessionIdentifier: (req) => {
      const raw: unknown = req.cookies?.[opts.accessCookieName];
      return typeof raw === 'string' ? raw : '';
    },
    cookieName: tieredCookieName(opts.cookieBaseName),
    cookieOptions: csrfCookieOptions(opts.path),
    ...(opts.skipIfNoAccessCookie || opts.skipPathPrefixes
      ? {
          skipCsrfProtection: (req: Request) => {
            if (
              opts.skipPathPrefixes?.some((prefix) => req.path.startsWith(prefix))
            ) {
              return true;
            }
            if (!opts.skipIfNoAccessCookie) return false;
            const raw: unknown = req.cookies?.[opts.accessCookieName];
            return typeof raw !== 'string' || raw === '';
          },
        }
      : {}),
  });

  return {
    doubleCsrfProtection,
    issue(req, res, accessToken, callOpts) {
      req.cookies ??= {};
      req.cookies[opts.accessCookieName] = accessToken;
      const token = generateCsrfToken(req, res, {
        overwrite: !callOpts?.reuseExisting,
        ...(callOpts?.cookiePath
          ? { cookieOptions: csrfCookieOptions(callOpts.cookiePath) }
          : {}),
      });
      res.setHeader(CSRF_RESPONSE_HEADER, token);
    },
  };
}
