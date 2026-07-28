const UAE_COUNTRY_CODE = '971';

// UAE-scoped, not a general international phone parser — this app's
// checkout only accepts UAE emirates as delivery addresses (see
// orders/constants.ts EMIRATES), and customer phone numbers are collected
// as plain local UAE numbers with no separate country-code field. A number
// already carrying its own country code (+ or 00 prefixed, or a non-UAE
// E.164 number) is left as-is; anything else is assumed local UAE and given
// the +971 prefix. Returns null (never throws) when the result still isn't
// a plausible E.164 number, so callers can skip-and-log rather than fail
// the surrounding operation.
// ponytail: hand-rolled rather than a full phone-parsing library — the
// single-country scope here doesn't need one; revisit with a real parser
// (e.g. libphonenumber-js) if this app ever serves customers outside the UAE.
export function normalizePhoneToE164(raw: string): string | null {
  if (!raw) return null;
  let digits = raw.trim().replace(/[\s\-()]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = UAE_COUNTRY_CODE + digits.slice(1);
  } else if (!digits.startsWith(UAE_COUNTRY_CODE)) {
    digits = UAE_COUNTRY_CODE + digits;
  }

  if (!/^\d{8,15}$/.test(digits)) return null;
  return `+${digits}`;
}
