import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { DIAL_CODES } from '../common/phone';

export const OTP_CODE_LENGTH = 6;
export const OTP_TTL_MS = 10 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 5;
export const PROOF_TTL_MS = 15 * 60 * 1000;
// Per phone: 1 per 60 s, 5 per hour, 10 per day.
export const SEND_LIMITS = { perMinute: 1, perHour: 5, perDay: 10 } as const;
export const SHOP_DAILY_CAP_DEFAULT = 500;

export function generateOtpCode(): string {
  return randomInt(0, 10 ** OTP_CODE_LENGTH)
    .toString()
    .padStart(OTP_CODE_LENGTH, '0');
}

// Key derived from the customer JWT secret (not the secret itself), the same way
// the 2FA pending-token keys are, so a code hash can never double as anything else.
function otpKey(): string {
  return createHmac('sha256', process.env.CUSTOMER_JWT_SECRET ?? '')
    .update('customer-phone-otp-v1')
    .digest('hex');
}

// Bound to the shop and phone: a hash copied to another shop's row never matches.
export function hashOtpCode(shopId: number, phone: string, code: string) {
  return createHmac('sha256', otpKey())
    .update(`${shopId}|${phone}|${code}`)
    .digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const x = Buffer.from(a, 'utf8');
  const y = Buffer.from(b, 'utf8');
  return x.length === y.length && timingSafeEqual(x, y);
}

// Only the shop's own country is allowed (no sending to arbitrary countries).
// A NULL/unknown countryCode is the legacy +971, as everywhere in phone.ts.
export function phoneInShopCountry(
  e164: string,
  countryCode: string | null | undefined,
): boolean {
  const dial =
    countryCode && Object.hasOwn(DIAL_CODES, countryCode)
      ? DIAL_CODES[countryCode]
      : DIAL_CODES.AE;
  return e164.startsWith(`+${dial}`);
}

export const PHONE_PROOF_SHAPE = /^[0-9a-f]{64}$/i;
