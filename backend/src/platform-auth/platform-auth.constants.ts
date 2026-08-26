import { tieredCookieName } from '../common/cookies';
import { createTierCsrf } from '../common/csrf';

// Single 12h access token, no refresh cookie — platform admin has no
// refresh mechanism today (see PlatformAuthService), so there's nothing to
// narrow-Path-scope the way the staff/customer refresh cookies will be.
export const PLATFORM_ACCESS_COOKIE = tieredCookieName('req-platform-at');

export const platformCsrf = createTierCsrf({
  cookieBaseName: 'req-platform-csrf',
  accessCookieName: PLATFORM_ACCESS_COOKIE,
  path: '/',
});
