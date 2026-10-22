import { hmacSha256Hex } from '../channels/hmac';
import { internalThrottleTracker, verifyInternalAuth } from './internal-auth';

const SECRET = 's'.repeat(32);
const NOW = 1_700_000_000;
const sign = (method: string, path: string, t: number, secret = SECRET) =>
  `t=${t},sig=${hmacSha256Hex(secret, `${method}\n${path}\n${t}`)}`;

describe('verifyInternalAuth', () => {
  it('accepts a correct signature inside the skew window', () => {
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW), NOW)).toBe(true);
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW - 60), NOW)).toBe(true);
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW + 60), NOW)).toBe(true);
  });

  it('rejects expired, future, forged, wrong-secret, wrong-path, wrong-method and malformed values', () => {
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW - 61), NOW)).toBe(false);
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW + 61), NOW)).toBe(false);
    expect(verifyInternalAuth(SECRET, 'GET', '/a', sign('GET', '/a', NOW, 'x'.repeat(32)), NOW)).toBe(false);
    expect(verifyInternalAuth(SECRET, 'GET', '/b', sign('GET', '/a', NOW), NOW)).toBe(false);
    expect(verifyInternalAuth(SECRET, 'POST', '/a', sign('GET', '/a', NOW), NOW)).toBe(false);
    for (const bad of [undefined, '', 'garbage', `t=${NOW}`, `t=${NOW},sig=zz`, `t=${NOW},sig=${'0'.repeat(64)}`, `t=-1,sig=${'a'.repeat(64)}`]) {
      expect(verifyInternalAuth(SECRET, 'GET', '/a', bad, NOW)).toBe(false);
    }
  });

  it('never verifies when no secret is configured (fail closed)', () => {
    expect(verifyInternalAuth(undefined, 'GET', '/a', sign('GET', '/a', NOW), NOW)).toBe(false);
    expect(verifyInternalAuth('', 'GET', '/a', sign('GET', '/a', NOW, ''), NOW)).toBe(false);
  });
});

describe('internalThrottleTracker', () => {
  const OLD = process.env.INTERNAL_API_SECRET;
  afterEach(() => {
    if (OLD === undefined) delete process.env.INTERNAL_API_SECRET;
    else process.env.INTERNAL_API_SECRET = OLD;
  });
  const now = () => Math.floor(Date.now() / 1000);
  const req = (headers: Record<string, string>, url = '/domains/resolve?host=a.b') => ({
    method: 'GET',
    originalUrl: url,
    headers,
  });

  it('is null without a secret or without a valid signature', () => {
    delete process.env.INTERNAL_API_SECRET;
    expect(internalThrottleTracker(req({ 'x-internal-auth': sign('GET', '/domains/resolve', now()) }))).toBeNull();
    process.env.INTERNAL_API_SECRET = SECRET;
    expect(internalThrottleTracker(req({}))).toBeNull();
    expect(internalThrottleTracker(req({ 'x-internal-client-ip': '203.0.113.9' }))).toBeNull();
  });

  it('buckets a verified call by the signed path, or by a valid forwarded client address', () => {
    process.env.INTERNAL_API_SECRET = SECRET;
    const auth = sign('GET', '/domains/resolve', now());
    expect(internalThrottleTracker(req({ 'x-internal-auth': auth }))).toBe('internal:path:/domains/resolve');
    expect(internalThrottleTracker(req({ 'x-internal-auth': auth, 'x-internal-client-ip': '203.0.113.9' }))).toBe('internal:ip:203.0.113.9');
    expect(internalThrottleTracker(req({ 'x-internal-auth': auth, 'x-internal-client-ip': 'not an ip' }))).toBe('internal:path:/domains/resolve');
  });
});
