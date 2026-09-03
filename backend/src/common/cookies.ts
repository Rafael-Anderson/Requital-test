import type { CookieOptions } from 'express';

// Session-cookie migration (security audit finding #1 — see CLAUDE.md).
// Shared attribute/name builders reused by every tier's auth module as each
// one migrates off localStorage — platform admin first (this file's first
// consumer), then staff, then customer.
//
// A function, not a `const` captured at module load, so a test can flip
// NODE_ENV per-run and exercise the production cookie shapes (the
// name-prefix helpers below still bake their result into per-tier constants
// at import time — a spec that needs the prod prefixes uses jest.isolateModules).
export function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

// __Host- is a browser-enforced cookie-name prefix: the browser refuses to
// even set a __Host- cookie unless it also has Secure + no Domain attribute
// + Path=/, and refuses to accept one over a set-cookie response that
// doesn't meet that bar. Real, extra protection in production (a subdomain
// can't shadow/override it the way it could a plain-named cookie), but
// local dev runs on plain http (see CLAUDE.md's Port note) — Secure cookies
// don't get set at all there, so the prefix would silently break every
// local login. Dropped outside production for exactly that reason, not
// because the guarantee doesn't matter.
//
// USE ONLY for cookies whose Path is `/`. A __Host- cookie with any other
// Path is silently dropped by every browser — see pathScopedCookieName.
export function tieredCookieName(base: string): string {
  return isProd() ? `__Host-${base}` : base;
}

// For a cookie deliberately scoped to a sub-path — the per-shop customer
// cookies (`/public/<slug>`), the narrowly-scoped refresh cookies
// (`/auth/refresh`, `/public/<slug>/auth/refresh`). `__Host-` mandates
// `Path=/`, so it CANNOT be used here: a `__Host-...; Path=/public/x` cookie
// is rejected outright by the browser and the session never persists (this
// was a real, latent prod bug — customer sessions had never actually stuck).
// `__Secure-` keeps the Secure-only + set-from-secure-origin guarantee with
// no Path constraint.
export function pathScopedCookieName(base: string): string {
  return isProd() ? `__Secure-${base}` : base;
}

// httpOnly session cookies (access/refresh tokens) all share this shape —
// only Path (and cookie name) vary per tier/purpose. `secure: false` in dev
// is required for the same plain-http reason as the __Host- prefix above;
// it is NOT optional/a convenience — a Secure cookie is simply never sent
// by the browser over http, so leaving this hardcoded true would silently
// break every non-production login.
//
// maxAgeMs, when passed, bounds the cookie's client-side lifetime. Omitting
// it makes a *session cookie* — one the browser keeps until its process
// exits, regardless of the token inside. That's wrong for the access
// cookie: a dead-JWT-but-still-present access cookie kept the tier CSRF
// middleware's `skipIfNoAccessCookie` from skipping on a cold /auth/login
// or /auth/refresh (nothing else had ever set that cookie's Path=/ value on
// a pre-login request), 403ing legitimate re-logins until a full browser
// restart cleared the jar. Set it to the access token's own lifetime so the
// cookie can't outlive the JWT. The refresh cookie is deliberately left as
// a session cookie (no maxAge) — persisting it across restarts is a "stay
// signed in" product choice, not this fix.
export function sessionCookieOptions(
  path: string,
  maxAgeMs?: number,
): CookieOptions {
  return {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'strict',
    path,
    ...(maxAgeMs !== undefined ? { maxAge: maxAgeMs } : {}),
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
    secure: isProd(),
    sameSite: 'strict',
    path,
  };
}
