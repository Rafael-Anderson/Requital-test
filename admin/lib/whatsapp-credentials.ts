// Mirrors backend/src/common/credential-sanitize.ts and
// backend/src/whatsapp/whatsapp-credential-validation.ts by hand (the apps share
// no code; change both together). The server is the authority: this only lets
// the form show the problem before a round trip.

// Zero-width and bidi control characters that ride along when a value is
// copied out of Meta Business Manager (a Phone Number ID arrives with U+2069).
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;

export function sanitizeCredentialValue(value: string): string {
  return value.replace(INVISIBLE, "").trim();
}

export const PHONE_NUMBER_ID_SHAPE = /^\d{10,20}$/;

export function whatsappCredentialProblems(input: {
  phoneNumberId: string;
  accessToken: string;
}): Record<string, string> {
  const problems: Record<string, string> = {};
  const id = sanitizeCredentialValue(input.phoneNumberId);
  const token = sanitizeCredentialValue(input.accessToken);
  if (!id) {
    problems.phoneNumberId = "Enter the Phone Number ID.";
  } else if (!PHONE_NUMBER_ID_SHAPE.test(id)) {
    problems.phoneNumberId =
      "The Phone Number ID is a number of 10 to 20 digits. Copy it from WhatsApp Manager > API Setup (not the phone number itself).";
  }
  if (!token) {
    problems.accessToken = "Enter the access token.";
  } else if (/\s/.test(token)) {
    problems.accessToken =
      "The access token cannot contain spaces or line breaks. Copy it again from Meta Business Manager.";
  }
  return problems;
}

// Meta's display number ("+971 50 123 4567") against the WhatsApp Number field
// (dial code + local number). Digits only; a local number's leading 0 is ignored.
// null = nothing to compare.
export function displayNumberMatches(
  displayPhoneNumber: string | null,
  countryCode: string,
  localNumber: string,
): boolean | null {
  const shown = (displayPhoneNumber ?? "").replace(/\D/g, "");
  const local = localNumber.replace(/\D/g, "").replace(/^0+/, "");
  if (!shown || !local) return null;
  const expected = `${countryCode.replace(/\D/g, "")}${local}`;
  return shown === expected;
}
