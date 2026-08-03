import { createHash, randomBytes } from 'crypto';

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

// Short, customer-facing order-tracking code — stored in plaintext on the
// order row (same threat model as paymentLinkToken: possession proves it's
// your order, it isn't a login credential, so no hash-at-rest needed). 5
// bytes of entropy is plenty for "guess someone else's order code" to be
// infeasible at this app's scale while staying short enough to read over
// the phone.
export function generateTrackingCode(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}

// Customer-facing survey link token — same shape/threat model as
// generateTrackingCode() above (plaintext, possession proves it's your
// survey, not a login credential). Kept as its own named function rather
// than reusing generateTrackingCode() directly so a future reader never
// confuses a survey token with an order-tracking code in the codebase.
export function generateSurveyToken(): string {
  return randomBytes(5).toString('hex').toUpperCase();
}
