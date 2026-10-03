import { createHash } from 'crypto';
import { createLogger } from '../logging/logger';

// Breached-password check against the Have I Been Pwned range API, by
// k-anonymity: only the first 5 hex characters of the password's SHA-1 ever
// leave this process (and 'Add-Padding' hides how many suffixes matched).
// The 35-character suffix is compared locally. The full hash and the suffix
// are never logged, never sent, never put in an error.
//
// FAILS OPEN by design: an unreachable/slow/erroring/garbled service must
// never lock anyone out of signup or a password reset, so every non-answer
// resolves to "not known breached" plus a structured warning that carries a
// fixed reason code only (not the URL, which contains the hash prefix, and
// not the error text).
const logger = createLogger('PasswordBreachCheck');

const DEFAULT_RANGE_URL = 'https://api.pwnedpasswords.com/range/';
const TIMEOUT_MS = 1500;

// The ONE place the two env vars are read.
//   PASSWORD_BREACH_CHECK=off   disables the remote check (the offline common
//                               list in common-passwords.ts still applies)
//   PASSWORD_BREACH_API_URL     base of the range endpoint (self-hosted mirror)
function config(): { enabled: boolean; baseUrl: string } {
  const off = (process.env.PASSWORD_BREACH_CHECK ?? '').toLowerCase() === 'off';
  return {
    enabled: !off,
    baseUrl: process.env.PASSWORD_BREACH_API_URL || DEFAULT_RANGE_URL,
  };
}

const LINE = /^([0-9A-F]{35}):(\d+)$/;

// true = known breached, false = not found or unknown (fail open).
export async function isBreachedPassword(password: string): Promise<boolean> {
  const { enabled, baseUrl } = config();
  if (!enabled) return false;

  const sha1 = createHash('sha1')
    .update(password, 'utf8')
    .digest('hex')
    .toUpperCase();
  const prefix = sha1.slice(0, 5);
  const suffix = sha1.slice(5);

  let body: string;
  try {
    const res = await fetch(
      baseUrl.endsWith('/') ? baseUrl + prefix : `${baseUrl}/${prefix}`,
      {
        headers: { 'Add-Padding': 'true' },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (res.status !== 200) {
      logger.warn('password breach check unavailable, allowing', {
        reason: `status_${res.status}`,
      });
      return false;
    }
    body = await res.text();
  } catch (err) {
    const timedOut = err instanceof Error && err.name === 'TimeoutError';
    logger.warn('password breach check unavailable, allowing', {
      reason: timedOut ? 'timeout' : 'network_error',
    });
    return false;
  }

  let sawLine = false;
  for (const raw of body.split('\n')) {
    const m = LINE.exec(raw.trim().toUpperCase());
    if (!m) continue;
    sawLine = true;
    // Count 0 is an Add-Padding decoy, not a real match.
    if (m[1] === suffix && Number(m[2]) > 0) return true;
  }
  if (!sawLine) {
    // A real response (padded) always has lines; none means garbage.
    logger.warn('password breach check unavailable, allowing', {
      reason: 'malformed',
    });
  }
  return false;
}
