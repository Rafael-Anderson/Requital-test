import {
  generateOtpCode,
  hashOtpCode,
  phoneInShopCountry,
  safeEqualHex,
} from './phone-otp';

describe('phone-otp helpers', () => {
  beforeAll(() => {
    process.env.CUSTOMER_JWT_SECRET = 'unit-test-secret';
  });

  it('codes are always 6 digits', () => {
    for (let i = 0; i < 500; i++) expect(generateOtpCode()).toMatch(/^\d{6}$/);
  });

  it('the hash binds shop, phone and code', () => {
    const h = hashOtpCode(1, '+971501234567', '123456');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(hashOtpCode(2, '+971501234567', '123456')).not.toBe(h);
    expect(hashOtpCode(1, '+971501234568', '123456')).not.toBe(h);
    expect(hashOtpCode(1, '+971501234567', '123457')).not.toBe(h);
    expect(h).not.toContain('123456');
  });

  it('constant-time compare handles unequal lengths', () => {
    expect(safeEqualHex('ab', 'ab')).toBe(true);
    expect(safeEqualHex('ab', 'abc')).toBe(false);
  });

  it('only the shop\'s own dial code is allowed', () => {
    expect(phoneInShopCountry('+971501234567', 'AE')).toBe(true);
    expect(phoneInShopCountry('+971501234567', 'SA')).toBe(false);
    expect(phoneInShopCountry('+96551234567', 'KW')).toBe(true);
    expect(phoneInShopCountry('+971501234567', null)).toBe(true);
    expect(phoneInShopCountry('+447911123456', null)).toBe(false);
  });
});
