// Redaction lives here, at the logger level, rather than at each call
// site — a call site logging an object "wholesale" (e.g. an entire DTO or
// DB row) must never rely on every future caller remembering to strip
// secrets by hand. Both key-name and value-pattern redaction are applied:
// key-name catches structured fields (password, token, ...); value-pattern
// catches the same secrets when they show up loose inside a plain string
// message (e.g. a bearer header interpolated into an error message).
export const REDACTED = '[REDACTED]';

const SENSITIVE_KEY_PATTERN =
  /password|passwordhash|token|secret|apikey|api_key|authorization|cvv|cvc|card(number|num)?|pan|bankaccount|iban|swift/i;

// JWT: three base64url segments separated by dots (header.payload.signature).
const JWT_PATTERN = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
// bcrypt hash: $2a$/$2b$/$2y$ + 2-digit cost + 53-char salt+hash.
const BCRYPT_PATTERN = /\$2[aby]\$\d{2}\$[A-Za-z0-9./]{53}/g;
// This app's own opaque tokens (common/token-hash.ts): 64 hex chars, either
// the raw 32-byte reset/verification/refresh token or its SHA-256 hash.
const OPAQUE_HEX_TOKEN_PATTERN = /\b[a-f0-9]{64}\b/gi;
const BEARER_PATTERN = /Bearer\s+\S+/gi;

function redactString(value: string): string {
  return value
    .replace(JWT_PATTERN, REDACTED)
    .replace(BCRYPT_PATTERN, REDACTED)
    .replace(BEARER_PATTERN, `Bearer ${REDACTED}`)
    .replace(OPAQUE_HEX_TOKEN_PATTERN, REDACTED);
}

export function redact(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (Array.isArray(value)) return value.map((v) => redact(v, seen));

  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(val, seen);
  }
  return out;
}
