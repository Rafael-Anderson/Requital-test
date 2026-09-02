import {
  isProd,
  tieredCookieName,
  pathScopedCookieName,
  sessionCookieOptions,
} from './cookies';

describe('cookies — prefix helpers', () => {
  const original = process.env.NODE_ENV;
  afterEach(() => {
    process.env.NODE_ENV = original;
  });

  it('isProd() reads NODE_ENV at call time (not captured at module load)', () => {
    process.env.NODE_ENV = 'test';
    expect(isProd()).toBe(false);
    process.env.NODE_ENV = 'production';
    expect(isProd()).toBe(true);
  });

  it('outside production: no prefix on either helper (plain http, Secure cookies never set)', () => {
    process.env.NODE_ENV = 'test';
    expect(tieredCookieName('req-staff-at')).toBe('req-staff-at');
    expect(pathScopedCookieName('req-customer-at')).toBe('req-customer-at');
  });

  it('in production: tieredCookieName uses __Host- (for Path=/ cookies only)', () => {
    process.env.NODE_ENV = 'production';
    expect(tieredCookieName('req-staff-at')).toBe('__Host-req-staff-at');
    expect(tieredCookieName('req-platform-at')).toBe('__Host-req-platform-at');
  });

  it('in production: pathScopedCookieName uses __Secure- (a __Host- cookie on a non-root Path is dropped by the browser)', () => {
    process.env.NODE_ENV = 'production';
    expect(pathScopedCookieName('req-customer-at')).toBe(
      '__Secure-req-customer-at',
    );
    expect(pathScopedCookieName('req-customer-rt')).toBe(
      '__Secure-req-customer-rt',
    );
    expect(pathScopedCookieName('req-staff-rt')).toBe('__Secure-req-staff-rt');
  });

  it('sessionCookieOptions.secure follows NODE_ENV at call time', () => {
    process.env.NODE_ENV = 'production';
    expect(sessionCookieOptions('/').secure).toBe(true);
    process.env.NODE_ENV = 'test';
    expect(sessionCookieOptions('/').secure).toBe(false);
  });
});

// The actual per-tier wiring (STAFF_ACCESS_COOKIE, CUSTOMER_ACCESS_COOKIE, ...
// using the right helper) is asserted end-to-end on real login responses in
// test/custom-domain-cookie.e2e-spec.ts, which boots the app with
// NODE_ENV=production — a truer check than re-importing the constants here.
