import { createHash, randomBytes } from 'crypto';
import { isDuplicateKeyError } from '../database/mysql-errors';

// Refresh tokens and password-reset/email-verification tokens are opaque
// random strings, not JWTs — the raw value only ever exists client-side and
// in the response that issued it; the DB stores only its SHA-256 hash, same
// principle as bcrypt for passwords but without the per-hash salt cost,
// since these are high-entropy random values already (32 bytes), not
// low-entropy user-chosen secrets.
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

// Customer-facing order-tracking token. Stored in plaintext on the order row
// (same threat model as paymentLinkToken: possession proves it's your order,
// it isn't a login credential, so no hash-at-rest needed), but it is a bearer
// capability for the public tracking page, so it gets 128 bits: 16 random
// bytes as 32 hex characters, same as the survey token and for the same
// reason (hex, not base64url: order.trackingToken uses a case-insensitive
// collation, so a mixed-case alphabet would silently lose entropy). Orders
// placed before this change carry a 10-hex (40-bit) token that stays valid:
// the column is VARCHAR(191), lookups are an exact match on the unique
// column, and TRACKING_TOKEN_SHAPE accepts both widths.
export const TRACKING_TOKEN_BYTES = 16;
export function generateTrackingToken(): string {
  return randomBytes(TRACKING_TOKEN_BYTES).toString('hex').toUpperCase();
}

// The only two shapes ever issued: 32 hex (current) and 10 hex (legacy). Used
// to answer anything else with the same 404 as an unknown token without a DB
// query (and so that a collation quirk, such as trailing spaces or Unicode
// look-alikes comparing equal under utf8mb4_unicode_ci, can never match).
export const TRACKING_TOKEN_SHAPE = /^(?:[0-9A-F]{32}|[0-9A-F]{10})$/i;

// Runs `insert` with a fresh tracking token, retrying with another one if the
// unique index rejects it. It cannot realistically collide at 128 bits; this
// keeps it from ever being a lost order. A duplicate on any other key (or a
// third collision) is rethrown. A failed INSERT statement does not abort the
// surrounding transaction, so this is safe inside db.transaction.
export async function withTrackingToken<T>(
  insert: (token: string) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await insert(generateTrackingToken());
    } catch (err) {
      if (
        attempt >= 3 ||
        !isDuplicateKeyError(err) ||
        !String((err as Error).message).includes('trackingToken')
      ) {
        throw err;
      }
    }
  }
}

// Customer-facing survey link token. Unlike the tracking code this one is a
// credential for a state change (submit, consent withdrawal), is never read
// aloud, and lives only in an emailed link, so it gets 128 bits: 16 random
// bytes as 32 hex characters. Hex (not base64url) on purpose: surveyresponse.token
// uses a case-insensitive collation, so a mixed-case alphabet would silently
// lose entropy per character. Tokens issued before this change are 10 hex
// characters and stay valid: lookups are an exact match on the unique column
// and nothing validates the token's length or shape.
export const SURVEY_TOKEN_BYTES = 16;
export function generateSurveyToken(): string {
  return randomBytes(SURVEY_TOKEN_BYTES).toString('hex').toUpperCase();
}
