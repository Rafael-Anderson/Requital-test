import { Transform } from 'class-transformer';

// One helper for every credential or provider id a merchant pastes (or the
// platform sets in env): strips the invisible characters that ride along when a
// value is copied out of a dashboard (Meta Business Manager appends U+2069 POP
// DIRECTIONAL ISOLATE to a Phone Number ID), then trims ordinary whitespace.
// Regex \s does not match any of these, so a whitespace check alone misses them.
//
// Removed, and nothing else:
//   U+200B-U+200F  zero-width space/joiners, LRM, RLM
//   U+202A-U+202E  bidi embeddings and overrides
//   U+2060-U+2069  word joiner, invisible operators, bidi isolates
//   U+FEFF         zero-width no-break space / BOM
//   U+00AD         soft hyphen
const INVISIBLE = /[\u200B-\u200F\u202A-\u202E\u2060-\u2069\uFEFF\u00AD]/g;

export function sanitizeCredentialValue(value: string): string {
  return value.replace(INVISIBLE, '').trim();
}

// Every string value of a credential map, sanitised; non-strings are kept as
// they are (a caller's own validation decides what to do with them).
export function sanitizeCredentialMap<T extends Record<string, unknown>>(
  map: T,
): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(map)) {
    out[k] = typeof v === 'string' ? sanitizeCredentialValue(v) : v;
  }
  return out as T;
}

// Same, for a possibly-absent value (null and undefined pass through).
export function sanitizeOptional<T>(value: T): T {
  return (
    typeof value === 'string' ? sanitizeCredentialValue(value) : value
  ) as T;
}

// DTO decorator: runs before class-validator (the global ValidationPipe has
// transform: true), so a pasted value with a stray bidi mark is cleaned, not
// rejected. Strings are sanitised; a plain object has each string value
// sanitised (credential maps); anything else is left for the validators.
export function SanitizeCredential(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) => {
    if (typeof value === 'string') return sanitizeCredentialValue(value);
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return sanitizeCredentialMap(value as Record<string, unknown>);
    }
    return value;
  });
}

// Platform-level credentials and ids read from the environment. Sanitised once,
// in place, at bootstrap (main.ts, before Nest builds any provider), so every
// later `process.env.X` read sees the clean value. Names only: no value is ever
// logged.
export const PLATFORM_CREDENTIAL_ENV = [
  'PLATFORM_WHATSAPP_PHONE_NUMBER_ID',
  'PLATFORM_WHATSAPP_ACCESS_TOKEN',
  'STRIPE_SECRET_KEY',
  'STRIPE_WEBHOOK_SECRET',
  'TELR_STORE_ID',
  'TELR_AUTH_KEY',
  'PAYTABS_PROFILE_ID',
  'PAYTABS_SERVER_KEY',
  'TABBY_PUBLIC_KEY',
  'TABBY_SECRET_KEY',
  'TABBY_WEBHOOK_SECRET',
  'TAMARA_PUBLIC_KEY',
  'TAMARA_TOKEN',
  'TAMARA_NOTIFICATION_TOKEN',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
  'PAYPAL_WEBHOOK_ID',
  'SLIDER_API_KEY',
  'SLIDER_WEBHOOK_TOKEN',
  'RESEND_API_KEY',
  'RESEND_DOMAINS_API_KEY',
  'DELIVEROO_SANDBOX_WEBHOOK_SECRET',
  'DELIVEROO_SANDBOX_CLIENT_ID',
  'DELIVEROO_SANDBOX_CLIENT_SECRET',
] as const;

export function sanitizePlatformCredentialEnv(
  env: NodeJS.ProcessEnv = process.env,
): void {
  for (const name of PLATFORM_CREDENTIAL_ENV) {
    const v = env[name];
    if (typeof v === 'string') env[name] = sanitizeCredentialValue(v);
  }
}
