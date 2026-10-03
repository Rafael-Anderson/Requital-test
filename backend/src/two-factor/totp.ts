import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { base32Decode, base32Encode } from './base32';

// RFC 6238 TOTP over RFC 4226 HOTP: HMAC-SHA1, 6 digits, 30 second step.
// These are the only parameters every authenticator app supports without the
// user choosing them, so they are fixed rather than configurable.
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
// A code is accepted from one step before to one step after the current one
// (clock drift between the phone and this server).
export const TOTP_WINDOW = 1;

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20)); // 160 bits, the RFC 4226 recommendation
}

export function hotp(
  secret: Buffer,
  counter: number,
  digits = TOTP_DIGITS,
): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(bin % 10 ** digits).padStart(digits, '0');
}

export function totpStep(nowMs: number): number {
  return Math.floor(nowMs / 1000 / TOTP_STEP_SECONDS);
}

export function totpCode(secretBase32: string, nowMs: number): string {
  return hotp(base32Decode(secretBase32), totpStep(nowMs));
}

// The matching time step, or null. All 2*window+1 candidates are compared
// with timingSafeEqual and none short-circuits, so how long this takes does
// not reveal which digit (or which step) was right. The caller must still
// refuse a step it has already accepted (replay), see TotpStore.
export function verifyTotp(
  secretBase32: string,
  code: string,
  nowMs: number,
): number | null {
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(code)) return null;
  const secret = base32Decode(secretBase32);
  const given = Buffer.from(code, 'utf8');
  const current = totpStep(nowMs);
  let matched: number | null = null;
  for (let d = -TOTP_WINDOW; d <= TOTP_WINDOW; d++) {
    const expected = Buffer.from(hotp(secret, current + d), 'utf8');
    if (timingSafeEqual(given, expected) && matched === null) {
      matched = current + d;
    }
  }
  return matched;
}

export function otpauthUri(opts: {
  issuer: string;
  account: string;
  secret: string;
}): string {
  const label = `${encodeURIComponent(opts.issuer)}:${encodeURIComponent(opts.account)}`;
  const q = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${q.toString()}`;
}
