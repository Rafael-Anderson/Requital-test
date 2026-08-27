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

// The CSRF cookie's own attributes. httpOnly here too, as of a fix found
// during phase 2/3's rollout (2026-08-27): the original design left this
// cookie JS-readable specifically so frontend code could pull the token's
// value via `document.cookie` (see this file's git history) — that only
// ever worked in local dev, where every app shares the bare `localhost`
// hostname and cookies aren't port-scoped. In any real deployment the admin/
// storefront apps and the API sit on genuinely different hostnames
// (admin.requital.io vs api.requital.io, {shop}.requital.io vs
// api.requital.io) — a cookie set by the API (host-only, no Domain
// attribute, by design) is invisible to `document.cookie` on a page loaded
// from a different hostname, full stop, regardless of any other attribute.
// Every tier's controller now instead returns the freshly-minted CSRF token
// value directly in the JSON response body (login/signup/refresh, and the
// "me" bootstrap endpoints) — see common/csrf.ts's `issue()`, whose return
// value is that string. The frontend holds it in memory, never localStorage
// (that would reintroduce the exact XSS-exposure problem this whole
// migration exists to close), and this cookie only has to keep round-
// tripping automatically with ordinary same-site requests, which httpOnly
// doesn't affect at all — the server still reads it via the plain Cookie
// header on every request, same as before.
export function csrfCookieOptions(path: string): CookieOptions {
  return {
    httpOnly: true,
    secure: IS_PROD,
    sameSite: 'strict',
    path,
  };
}
