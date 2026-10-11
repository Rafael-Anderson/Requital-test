import { createHash, randomBytes, randomInt, timingSafeEqual } from 'crypto';

// Customer one-time delivery code: 6 digits, uniformly random (crypto.randomInt,
// not Math.random). Only a salted SHA-256 is stored; the salt is per stop so two
// identical codes never share a hash. 10^6 codes are brute-forceable offline from
// a leaked hash, which is why the real defences are the attempt cap and the short
// expiry enforced in SQL (see DriverAppService), not the hash.
export function generateOtp(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

export function newOtpSalt(): string {
  return randomBytes(16).toString('hex'); // 32 hex chars, matches CHAR(32)
}

export function hashOtp(stopId: number, salt: string, code: string): string {
  return createHash('sha256').update(`${stopId}:${salt}:${code}`).digest('hex');
}

// Constant-time. Both sides are 64 hex chars, but a malformed stored value must
// not throw (timingSafeEqual throws on a length mismatch), it simply fails.
export function otpMatches(
  stopId: number,
  salt: string,
  code: string,
  storedHash: string,
): boolean {
  const a = Buffer.from(hashOtp(stopId, salt, code), 'hex');
  const b = Buffer.from(storedHash, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}
