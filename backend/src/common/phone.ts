// Dial codes of the six countries a shop can be registered in
// (shop/constants.ts's COUNTRY_CODES, keyed here by the same ISO codes).
export const DIAL_CODES: Readonly<Record<string, string>> = {
  AE: '971',
  SA: '966',
  KW: '965',
  QA: '974',
  BH: '973',
  OM: '968',
};

// LEGACY, not a default for new countries: before shops had a country, every
// bare local number was assumed UAE. A shop whose countryCode is NULL
// ("Other", unknown, or pre-dating the column) still gets exactly that, so no
// stored or looked-up phone for such a shop changes. A countryCode we have no
// dial code for falls back the same way rather than guessing.
const LEGACY_DIAL_CODE = DIAL_CODES.AE;

// Not a general international phone parser. A number already carrying its own
// country code (+ or 00 prefixed) is left as-is. Anything else is a local
// number of the shop's own country (`countryCode`, e.g. 'SA') and gets that
// country's dial code; NULL/unknown countryCode keeps the legacy +971 above.
// A bare digit string that already starts with the dial code is taken as
// carrying it. For 971 (legacy behaviour, kept byte-identical) that is
// unconditional; for the other codes it also needs 8+ digits after the code,
// since 8-digit local numbers (KW/QA/BH/OM) can themselves begin with the
// dial code's digits. Returns null (never throws) when the result still isn't
// a plausible E.164 number, so callers can skip-and-log rather than fail
// the surrounding operation.
// ponytail: hand-rolled rather than a full phone-parsing library; revisit
// with libphonenumber-js if per-country number-length rules are ever needed.
export function normalizePhoneToE164(
  raw: string,
  countryCode?: string | null,
): string | null {
  if (!raw) return null;
  const dial =
    countryCode && Object.hasOwn(DIAL_CODES, countryCode)
      ? DIAL_CODES[countryCode]
      : LEGACY_DIAL_CODE;
  let digits = raw.trim().replace(/[\s\-()]/g, '');

  if (digits.startsWith('+')) {
    digits = digits.slice(1);
  } else if (digits.startsWith('00')) {
    digits = digits.slice(2);
  } else if (digits.startsWith('0')) {
    digits = dial + digits.slice(1);
  } else if (
    !digits.startsWith(dial) ||
    (dial !== LEGACY_DIAL_CODE && digits.length < dial.length + 8)
  ) {
    digits = dial + digits;
  }

  if (!/^\d{8,15}$/.test(digits)) return null;
  return `+${digits}`;
}
