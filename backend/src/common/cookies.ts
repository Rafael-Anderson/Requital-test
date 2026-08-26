import type { CookieOptions } from 'express';

// Session-cookie migration (security audit finding #1 — see CLAUDE.md).
// Shared attribute/name builders reused by every tier's auth module as each
// one migrates off localStorage — platform admin first (this file's first
// consumer), then staff, then customer.
const IS_PROD = process.env.NODE_ENV === 'production';

// __Host- is a browser-enforced cookie-name prefix: the browser refuses to
// even set a __Host- cookie unless it also has Secure + no Domain attribute
// + Path=/, and refuses to accept one over a set-cookie response that
// doesn't meet that bar. Real, extra protection in production (a subdomain
// can't shadow/override it the way it could a plain-named cookie), but
// local dev runs on plain http (see CLAUDE.md's Port note) — Secure cookies
// don't get set at all there, so the prefix would silently break every
// local login. Dropped outside production for exactly that reason, not
// because the guarantee doesn't matter.
export function tieredCookieName(base: string): string {
  return IS_PROD ? `__Host-${base}` : base;
}

// httpOnly session cookies (access/refresh tokens) all share this shape —
// only Path (and cookie name) vary per tier/purpose. `secure: false` in dev
// is required for the same plain-http reason as the __Host- prefix above;
// it is NOT optional/a convenience — a Secure cookie is simply never sent
// by the browser over http, so leaving this hardcoded true would silently
// break every non-production login.
export function sessionCookieOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path,
  };
}

// The one cookie that must stay JS-readable — see common/csrf.ts.
export function readableCookieOptions(path: string): CookieOptions {
  return {
    httpOnly: false,
    secure: IS_PROD,
    sameSite: 'strict',
    path,
  };
}
