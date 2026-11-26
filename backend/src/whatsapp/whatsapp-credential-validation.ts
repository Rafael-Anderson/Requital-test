import { sanitizeCredentialValue } from '../common/credential-sanitize';

// Shape checks for the WhatsApp Business API credentials, run AFTER the
// invisible-character clean-up (credential-sanitize.ts). Mirrored by hand in
// admin/lib/whatsapp-credentials.ts.
//
// Meta's Phone Number ID is a number, roughly 10 to 20 digits (15 to 16 today).
export const PHONE_NUMBER_ID_SHAPE = /^\d{10,20}$/;
const HAS_WHITESPACE = /\s/;

export function whatsappCredentialProblems(input: {
  phoneNumberId?: unknown;
  accessToken?: unknown;
}): Record<string, string> {
  const problems: Record<string, string> = {};
  const id =
    typeof input.phoneNumberId === 'string'
      ? sanitizeCredentialValue(input.phoneNumberId)
      : '';
  const token =
    typeof input.accessToken === 'string'
      ? sanitizeCredentialValue(input.accessToken)
      : '';
  if (!id) {
    problems.phoneNumberId = 'Enter the Phone Number ID.';
  } else if (!PHONE_NUMBER_ID_SHAPE.test(id)) {
    problems.phoneNumberId =
      'The Phone Number ID is a number of 10 to 20 digits. Copy it from WhatsApp Manager > API Setup (not the phone number itself).';
  }
  if (!token) {
    problems.accessToken = 'Enter the access token.';
  } else if (HAS_WHITESPACE.test(token)) {
    problems.accessToken =
      'The access token cannot contain spaces or line breaks. Copy it again from Meta Business Manager.';
  }
  return problems;
}
