import { createHash, randomBytes, timingSafeEqual } from 'crypto';

// 16 characters from base32 minus the look-alikes = 80 bits of entropy per
// code. High enough that the stored SHA-256 cannot be brute-forced offline
// from a database leak (a 6 digit TOTP, or a 40 bit code, could be).
const ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no I L O U 0 1
export const RECOVERY_CODE_COUNT = 10;

function randomCode(): string {
  let raw = '';
  // rejection sampling so the alphabet size does not bias the characters
  while (raw.length < 16) {
    for (const b of randomBytes(32)) {
      if (b < 240 && raw.length < 16) raw += ALPHABET[b % ALPHABET.length];
    }
  }
  return raw.match(/.{4}/g)!.join('-');
}

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, randomCode);
}

// What a user types (any case, with or without dashes/spaces) -> canonical.
export function normalizeRecoveryCode(input: string): string {
  return input.toUpperCase().replace(/[\s-]/g, '');
}

export function looksLikeRecoveryCode(input: string): boolean {
  return /^[A-Z0-9]{16}$/.test(normalizeRecoveryCode(input));
}

export function hashRecoveryCode(input: string): string {
  return createHash('sha256')
    .update(normalizeRecoveryCode(input))
    .digest('hex');
}

// Index of the stored hash that matches, comparing EVERY entry in constant
// time (no early exit), or -1.
export function findRecoveryCode(
  input: string,
  storedHashes: string[],
): number {
  const given = Buffer.from(hashRecoveryCode(input), 'hex');
  let found = -1;
  storedHashes.forEach((h, i) => {
    const stored = Buffer.from(h, 'hex');
    if (
      stored.length === given.length &&
      timingSafeEqual(stored, given) &&
      found === -1
    ) {
      found = i;
    }
  });
  return found;
}
