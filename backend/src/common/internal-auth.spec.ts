import { hmacSha256Hex } from '../channels/hmac';
import {
  internalThrottleTracker,
  isInternalBucketRoute,
  verifyInternalAuth,
} from './internal-auth';

const SECRET = 's'.repeat(32);
const NOW = 1_700_000_000;
const sign = (method: string, path: string, t: number, secret = SECRET) =>
  `t=${t},sig=${hmacSha256Hex(secret, `${method}\n${path}\n${t}`)}`;

describe('verifyInternalAuth', () => {
  it('accepts a correct signature inside the skew window', () => {
    expect(
      verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW), NOW),
    ).toBe(true);
    expect(
      verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW - 60), NOW),
    ).toBe(true);
    expect(
      verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW + 60), NOW),
    ).toBe(true);
  });

  it('rejects expired, future, forged, wrong-secret, wrong-path, wrong-method and malformed values', () => {
    expect(
      verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW - 61), NOW),
    ).toBe(false);
    expect(
      verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW + 61), NOW),
    ).toBe(false);
    expect(
      verifyInternalAuth(
        SECRET,
        'GET',
        '/a',
        sign('GET', '/a', NOW, 'x'.repeat(32)),
        NOW,
      ),
    ).toBe(false);
    expect(
      verifyInternalAuth(SECRET, 'GET', '/b', sign('GET', '/a', NOW), NOW),
    ).toBe(false);
    expect(
      verifyInternalAuth(SECRET, 'POST', '/a', sign('GET', '/a', NOW), NOW),
    ).toBe(false);
    for (const bad of [
      undefined,
      '',
      'garbage',
      `t=${NOW}`,
      `t=${NOW},sig=zz`,
      `t=${NOW},sig=${'0'.repeat(64)}`,
      `t=-1,sig=${'a'.repeat(64)}`,
    ]) {
      expect(verifyInternalAuth(SECRET, 'GET', '/a', bad, NOW)).toBe(false);
    }
  });

  it('never verifies when no secret is configured (fail closed)', () => {
    expect(
      verifyInternalAuth(undefined, 'GET', '/a', sign('GET', '/a', NOW), NOW),
    ).toBe(false);
    expect(
      verifyInternalAuth('', 'GET', '/a', sign('GET', '/a', NOW, ''), NOW),
    ).toBe(false);
  });
});

describe('internalThrottleTracker', () => {
  const OLD = process.env.INTERNAL_API_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = OLD;
  });
  const now = () => Math.floor(Date.now() / 1000);
  const req = (
    headers: Record<string, string>,
    url = '/domains/resolve?host=a.b',
  ) => ({
    method: 'GET',
    originalUrl: url,
    headers,
  });

  it('is null without a secret or without a valid signature', () => {
    delete process.env.INTERNAL_API_SECRET;
    expect(
      internalThrottleTracker(
        req({ 'x-internal-auth': sign('GET', '/domains/resolve', now()) }),
      ),
    ).toBeNull();
    process.env.INTERNAL_API_SECRET = SECRET;
    expect(internalThrottleTracker(req({}))).toBeNull();
    expect(
      internalThrottleTracker(req({ 'x-internal-client-ip': '203.0.113.9' })),
    ).toBeNull();
  });

  it('buckets a verified call by the signed path, or by a valid forwarded client address', () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    const auth = sign('GET', '/domains/resolve', now());
    expect(internalThrottleTracker(req({ 'x-internal-auth': auth }))).toBe(
      'internal:path:/domains/resolve',
    );
    expect(
      internalThrottleTracker(
        req({ 'x-internal-auth': auth, 'x-internal-client-ip': '203.0.113.9' }),
      ),
    ).toBe('internal:ip:203.0.113.9');
    expect(
      internalThrottleTracker(
        req({ 'x-internal-auth': auth, 'x-internal-client-ip': 'not an ip' }),
      ),
    ).toBe('internal:path:/domains/resolve');
  });
});

describe('isInternalBucketRoute (only read-only public GETs may leave the IP bucket)', () => {
  it('allows the routes the storefront server reads', () => {
    for (const path of [
      '/domains/resolve',
      '/public/shops/sitemap',
      '/public/acme',
      '/public/acme/theme-config',
      '/public/acme/outlets',
      '/public/acme/products/slug/rose/related',
      '/public/acme/collections/roses',
      '/public/acme/policy-pages/TERMS',
      '/public/acme/redirects/map',
      '/public/acme/discounts/auto',
    ]) {
      expect(isInternalBucketRoute('GET', path)).toBe(true);
    }
  });

  it('refuses everything else, whatever the method', () => {
    for (const path of [
      '/auth/login',
      '/auth/signup',
      '/auth/forgot-password',
      '/public/orders/lookup',
      '/public/surveys/lookup',
      '/public/abandoned-carts/recover',
      '/public/acme/geocode',
      '/public/acme/reverse-geocode',
      '/public/acme/discounts/validate',
      '/public/acme/gift-cards/validate',
      '/public/acme/orders',
      '/public/acme/delivery-quote',
      '/public/acme/account/export',
      '/public/acme/search',
      '/domains/verify',
      '/public/acme/theme-config/extra/a/b/c',
    ]) {
      expect(isInternalBucketRoute('GET', path)).toBe(false);
    }
    expect(isInternalBucketRoute('POST', '/domains/resolve')).toBe(false);
    expect(isInternalBucketRoute('POST', '/public/acme/redirects/hits')).toBe(
      false,
    );
  });

  it('a verified signature on a refused route or method gives no internal tracker', () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    const t = Math.floor(Date.now() / 1000);
    const post = (path: string) => ({
      method: 'POST',
      originalUrl: path,
      headers: {
        'x-internal-auth': sign('POST', path, t),
        'x-internal-client-ip': '203.0.113.9',
      },
    });
    expect(internalThrottleTracker(post('/auth/login'))).toBeNull();
    expect(internalThrottleTracker(post('/domains/resolve'))).toBeNull();
    const lookup = '/public/orders/lookup';
    expect(
      internalThrottleTracker({
        method: 'GET',
        originalUrl: `${lookup}?token=x`,
        headers: { 'x-internal-auth': sign('GET', lookup, t) },
      }),
    ).toBeNull();
    delete process.env.INTERNAL_API_SECRET;
  });

  it('trims the secret like the storefront does', () => {
    process.env.INTERNAL_API_SECRET = `  ${SECRET}\n`;
    const t = Math.floor(Date.now() / 1000);
    expect(
      internalThrottleTracker({
        method: 'GET',
        originalUrl: '/domains/resolve?host=a.b',
        headers: { 'x-internal-auth': sign('GET', '/domains/resolve', t) },
      }),
    ).toBe('internal:path:/domains/resolve');
    delete process.env.INTERNAL_API_SECRET;
  });
});
