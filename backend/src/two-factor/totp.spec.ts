import { base32Decode, base32Encode } from './base32';
import {
  generateTotpSecret,
  hotp,
  otpauthUri,
  totpCode,
  verifyTotp,
} from './totp';
import {
  findRecoveryCode,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
} from './recovery-codes';

// RFC 4648 section 10 test vectors.
describe('base32', () => {
  const vectors: Array<[string, string]> = [
    ['', ''],
    ['f', 'MY'],
    ['fo', 'MZXQ'],
    ['foo', 'MZXW6'],
    ['foob', 'MZXW6YQ'],
    ['fooba', 'MZXW6YTB'],
    ['foobar', 'MZXW6YTBOI'],
  ];
  it.each(vectors)('encodes %j as %s and back', (plain, enc) => {
    expect(base32Encode(Buffer.from(plain))).toBe(enc);
    expect(base32Decode(enc).toString()).toBe(plain);
  });
  it('decode ignores case, spaces, dashes and padding, and rejects junk', () => {
    expect(base32Decode('mzxw 6ytb-oi======').toString()).toBe('foobar');
    expect(() => base32Decode('MZXW1')).toThrow(); // '1' is not in the alphabet
  });
  it('round-trips random bytes', () => {
    const b = Buffer.from(Array.from({ length: 33 }, (_, i) => (i * 37) % 256));
    expect(base32Decode(base32Encode(b)).equals(b)).toBe(true);
  });
});

// RFC 6238 appendix B (SHA-1, secret "12345678901234567890"); the RFC lists
// 8-digit codes, the 6-digit code is the last six of those.
describe('TOTP (RFC 6238 test vectors, SHA-1)', () => {
  const secret = base32Encode(Buffer.from('12345678901234567890'));
  const vectors: Array<[number, string, string]> = [
    [59, '94287082', '287082'],
    [1111111109, '07081804', '081804'],
    [1111111111, '14050471', '050471'],
    [1234567890, '89005924', '005924'],
    [2000000000, '69279037', '279037'],
    [20000000000, '65353130', '353130'],
  ];
  it.each(vectors)('T=%i -> %s (6 digits %s)', (t, eight, six) => {
    expect(
      hotp(Buffer.from('12345678901234567890'), Math.floor(t / 30), 8),
    ).toBe(eight);
    expect(totpCode(secret, t * 1000)).toBe(six);
  });

  it('accepts the current step and +/-1, rejects +/-2 and returns the matched step', () => {
    const now = 1234567890 * 1000;
    const step = Math.floor(now / 30000);
    expect(verifyTotp(secret, totpCode(secret, now), now)).toBe(step);
    expect(verifyTotp(secret, totpCode(secret, now - 30000), now)).toBe(
      step - 1,
    );
    expect(verifyTotp(secret, totpCode(secret, now + 30000), now)).toBe(
      step + 1,
    );
    expect(verifyTotp(secret, totpCode(secret, now - 60000), now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, now + 60000), now)).toBeNull();
  });

  it('rejects malformed codes without throwing', () => {
    const now = 59000;
    for (const bad of [
      '',
      '12345',
      '1234567',
      'abcdef',
      '12 345',
      '０８１８０４',
    ]) {
      expect(verifyTotp(secret, bad, now)).toBeNull();
    }
  });
});

describe('secret and otpauth URI', () => {
  it('generates 160-bit base32 secrets that differ each time', () => {
    const a = generateTotpSecret();
    expect(a).toMatch(/^[A-Z2-7]{32}$/);
    expect(generateTotpSecret()).not.toBe(a);
  });
  it('builds the standard otpauth URI', () => {
    const uri = otpauthUri({
      issuer: 'Requital',
      account: 'a+b@x.com',
      secret: 'ABCDEFGH',
    });
    expect(uri).toBe(
      'otpauth://totp/Requital:a%2Bb%40x.com?secret=ABCDEFGH&issuer=Requital&algorithm=SHA1&digits=6&period=30',
    );
  });
});

describe('recovery codes', () => {
  it('generates 10 distinct 16-character codes in groups of four', () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/);
  });
  it('normalises case, dashes and spaces, and hashes to the same value', () => {
    const [c] = generateRecoveryCodes(1);
    expect(hashRecoveryCode(c.toLowerCase().replace(/-/g, ' '))).toBe(
      hashRecoveryCode(c),
    );
    expect(normalizeRecoveryCode(c)).toHaveLength(16);
    expect(looksLikeRecoveryCode(c)).toBe(true);
    expect(looksLikeRecoveryCode('123456')).toBe(false);
  });
  it('finds the matching stored hash, and only that one', () => {
    const codes = generateRecoveryCodes();
    const hashes = codes.map(hashRecoveryCode);
    expect(findRecoveryCode(codes[7], hashes)).toBe(7);
    expect(findRecoveryCode('AAAA-AAAA-AAAA-AAAA', hashes)).toBe(-1);
    expect(findRecoveryCode(codes[0], [])).toBe(-1);
  });
  it('never stores the plaintext: the hash is not the code', () => {
    const [c] = generateRecoveryCodes(1);
    expect(hashRecoveryCode(c)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashRecoveryCode(c)).not.toContain(normalizeRecoveryCode(c));
  });
});
