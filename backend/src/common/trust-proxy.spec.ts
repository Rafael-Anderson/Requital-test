import { isValidTrustProxy, parseTrustProxy } from './trust-proxy';

describe('parseTrustProxy', () => {
  it.each([undefined, '', '   '])('%j means trust nothing', (raw) => {
    expect(parseTrustProxy(raw)).toBe(false);
  });

  it('accepts a hop count', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('10')).toBe(10);
  });

  it('accepts keywords, addresses and CIDR ranges, trimmed and lower-cased', () => {
    expect(parseTrustProxy('loopback')).toEqual(['loopback']);
    expect(
      parseTrustProxy(
        'Loopback, 10.0.0.0/8 ,173.245.48.0/20,2400:cb00::/32,::1,203.0.113.9',
      ),
    ).toEqual([
      'loopback',
      '10.0.0.0/8',
      '173.245.48.0/20',
      '2400:cb00::/32',
      '::1',
      '203.0.113.9',
    ]);
    expect(parseTrustProxy('linklocal,uniquelocal')).toEqual([
      'linklocal',
      'uniquelocal',
    ]);
  });

  it.each([
    'true',
    'TRUE',
    'false',
    '*',
    'all',
    'yes',
    '0',
    '11',
    '999',
    '-1',
    '1.5',
    '0.0.0.0/0',
    '::/0',
    '10.0.0.0/7',
    '2000::/15',
    '1.2.3.4/33',
    '::1/129',
    '1.2.3.4/8/9',
    '1.2.3.4/',
    '1.2.3.4/x',
    'not-an-ip',
    '300.1.1.1',
    'loopback,,',
    ',loopback',
    'loopback;10.0.0.1',
    'loopback 10.0.0.1',
  ])('refuses %j', (raw) => {
    expect(() => parseTrustProxy(raw)).toThrow(/TRUST_PROXY/);
    expect(isValidTrustProxy(raw)).toBe(false);
  });

  it('the error names every bad entry', () => {
    expect(() => parseTrustProxy('loopback,bogus,0.0.0.0/0')).toThrow(
      /"bogus", "0\.0\.0\.0\/0"/,
    );
  });

  it('isValidTrustProxy is true for what parse accepts', () => {
    expect(isValidTrustProxy('loopback')).toBe(true);
    expect(isValidTrustProxy('2')).toBe(true);
  });
});
