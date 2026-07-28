import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';

// No encryption-at-rest utility existed anywhere in this codebase before
// this — token-hash.ts is one-way hashing (fine for opaque bearer tokens,
// useless for merchant-supplied payment-gateway API keys, which the app
// must be able to read back to actually call the gateway). AES-256-GCM via
// Node's built-in `crypto` — no new dependency, authenticated (a tampered
// ciphertext fails to decrypt rather than silently returning garbage).
//
// CREDENTIAL_ENCRYPTION_KEY is a passphrase, not a raw key — scrypt-derived
// into a 32-byte key so the env var can be any length/format, same tradeoff
// as JWT_SECRET being a plain string rather than a hex-encoded key.
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT = 'requital-credential-encryption'; // fixed salt: a per-value random salt would need its own storage; this is a symmetric app-wide key, not a password hash, so a fixed salt is the accepted tradeoff here.

function deriveKey(): Buffer {
  const passphrase = process.env.CREDENTIAL_ENCRYPTION_KEY;
  if (!passphrase) {
    throw new Error(
      'CREDENTIAL_ENCRYPTION_KEY is not configured — required to store/read payment gateway credentials',
    );
  }
  return scryptSync(passphrase, SALT, 32);
}

// Format: iv:authTag:ciphertext, all hex — a single string so it stores in
// one TEXT column without a separate structured shape.
export function encrypt(plaintext: string): string {
  const key = deriveKey();
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${ciphertext.toString('hex')}`;
}

export function decrypt(encrypted: string): string {
  const [ivHex, authTagHex, ciphertextHex] = encrypted.split(':');
  if (!ivHex || !authTagHex || !ciphertextHex) {
    throw new Error('Malformed encrypted value');
  }
  const key = deriveKey();
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextHex, 'hex')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}
