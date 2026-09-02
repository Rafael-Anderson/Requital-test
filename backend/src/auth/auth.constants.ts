import { tieredCookieName, pathScopedCookieName } from '../common/cookies';
import { createTierCsrf } from '../common/csrf';

// Session-cookie migration (security audit finding #1), phase 2 — see
// CLAUDE.md's "Session-cookie migration, phase 2 of 3" note. Access cookie
// is Path=/ (sent on every request); refresh cookie is narrowly scoped to
// the one route that ever needs it, matching the cookie-design table in the
// approved migration plan.
export const STAFF_ACCESS_COOKIE = tieredCookieName('req-staff-at');
// Path=/auth/refresh, not `/` — must be __Secure-, not __Host- (which the
// browser drops on any non-root path). See pathScopedCookieName.
export const STAFF_REFRESH_COOKIE = pathScopedCookieName('req-staff-rt');
export const STAFF_REFRESH_PATH = '/auth/refresh';

export const staffCsrf = createTierCsrf({
  cookieBaseName: 'req-staff-csrf',
  accessCookieName: STAFF_ACCESS_COOKIE,
  path: '/',
  // Applied globally (see AppModule.configure) rather than scoped to a
  // handful of controllers — virtually every route in the app sits behind
  // the staff cookie, so there's no closed prefix to name. See createTierCsrf's
  // own comment on why "skip when this tier's cookie is absent" is still a
  // real, uncompromised CSRF guarantee.
  skipIfNoAccessCookie: true,
  // See createTierCsrf's own comment on skipPathPrefixes: a platform admin
  // impersonating a shop while also carrying their own separate merchant
  // login in the same browser must not have this tier's CSRF check fire on
  // a platform-admin-authenticated request — that surface already has its
  // own CSRF protection (platformCsrf, narrowly scoped).
  skipPathPrefixes: ['/platform-admin', '/platform-auth'],
});
