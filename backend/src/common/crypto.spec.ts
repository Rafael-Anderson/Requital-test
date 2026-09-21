import { decrypt, encrypt } from './crypto';

describe('crypto (credential encryption)', () => {
  const originalKey = process.env.CREDENTIAL_ENCRYPTION_KEY;

  beforeAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-key';
  });

  afterAll(() => {
    process.env.CREDENTIAL_ENCRYPTION_KEY = originalKey;
  });

  it('round-trips a plaintext value', () => {
    const plaintext = JSON.stringify({
      secretKey: 'sk_live_abc123',
      webhookSecret: 'whsec_xyz',
    });
    const encrypted = encrypt(plaintext);
    expect(decrypt(encrypted)).toBe(plaintext);
  });

  it('never stores the plaintext as a substring of the encrypted value', () => {
    const plaintext = 'sk_live_super_secret_key_1234567890';
    const encrypted = encrypt(plaintext);
    expect(encrypted).not.toContain(plaintext);
  });

  it('produces a different ciphertext each time (random IV), even for the same plaintext', () => {
    const plaintext = 'sk_live_abc123';
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it('rejects a tampered ciphertext instead of silently returning garbage', () => {
    const encrypted = encrypt('sk_live_abc123');
    const [iv, authTag, ciphertext] = encrypted.split(':');
    // Flip the last byte rather than overwriting it with a constant.
    // This previously appended '00', which is a NO-OP whenever the
    // ciphertext already ends in 00 - the value then decrypts fine and
    // this expectation fails. The ciphertext is random per run (random
    // IV), so that was a 1-in-256 failure on every CI run, measured at
    // 0.388% over 200k samples. It fired on main on 2026-09-21.
    const lastByte = parseInt(ciphertext.slice(-2), 16);
    const flipped = (lastByte ^ 0xff).toString(16).padStart(2, '0');
    const tampered = `${iv}:${authTag}:${ciphertext.slice(0, -2)}${flipped}`;
    // The guard that makes the flake structurally impossible rather than
    // merely unlikely: if the 'tampering' ever stops changing anything,
    // this fails loudly instead of silently asserting nothing.
    expect(tampered).not.toBe(encrypted);
    expect(() => decrypt(tampered)).toThrow();
  });

  it('throws a clear error when CREDENTIAL_ENCRYPTION_KEY is not configured', () => {
    delete process.env.CREDENTIAL_ENCRYPTION_KEY;
    expect(() => encrypt('anything')).toThrow(/CREDENTIAL_ENCRYPTION_KEY/);
    process.env.CREDENTIAL_ENCRYPTION_KEY = 'test-only-key';
  });
});
