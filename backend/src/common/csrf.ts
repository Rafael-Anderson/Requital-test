import { doubleCsrf } from 'csrf-csrf';
import type { Request, Response } from 'express';
import { readableCookieOptions, tieredCookieName } from './cookies';

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
export interface TierCsrf {
  doubleCsrfProtection: ReturnType<typeof doubleCsrf>['doubleCsrfProtection'];
  // Mints (or reuses) the CSRF cookie for the *current* response. Must be
  // called after the tier's access-token cookie has been written to `res`
  // — pass that same access token here so getSessionIdentifier can see it;
  // csrf-csrf reads the session identifier off `req`, not `res`, and at
  // login/refresh time the just-issued access token isn't on `req.cookies`
  // yet (it only reflects what the *incoming* request already had), so this
  // patches `req.cookies` in place before generating.
  issue(req: Request, res: Response, accessToken: string): void;
}

export function createTierCsrf(opts: {
  cookieBaseName: string;
  accessCookieName: string;
  path: string;
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
    cookieOptions: readableCookieOptions(opts.path),
  });

  return {
    doubleCsrfProtection,
    issue(req, res, accessToken) {
      req.cookies ??= {};
      req.cookies[opts.accessCookieName] = accessToken;
      generateCsrfToken(req, res, { overwrite: true });
    },
  };
}
