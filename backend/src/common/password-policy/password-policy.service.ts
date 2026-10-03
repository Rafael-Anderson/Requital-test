import {
  BadRequestException,
  Global,
  Injectable,
  Module,
} from '@nestjs/common';
import { COMMON_PASSWORDS } from './common-passwords';
import { isBreachedPassword } from './breach-check';

// NIST SP 800-63B style: length and "is it a known-bad password", no
// composition rules (no "needs a digit and a symbol"). Applied wherever a
// password is CHOSEN (signup, change, reset, invite accept, staff creation,
// customer register/reset), never to login, and never retroactively: an
// existing password is not re-checked, so nobody is locked out by this.
export const PASSWORD_MIN_LENGTH = 8;
// bcrypt only reads the first 72 BYTES; the DTOs' @MaxLength(72) counts
// characters, so a 40-character emoji password would sail past it and be
// silently truncated. Rejected here, explicitly, by UTF-8 byte length.
export const PASSWORD_MAX_BYTES = 72;

export interface PasswordIdentity {
  email?: string | null;
  name?: string | null;
  shopName?: string | null;
  subdomain?: string | null;
  phone?: string | null;
}

export type PasswordViolation =
  'too_short' | 'too_long' | 'matches_identity' | 'too_common' | 'breached';

const MESSAGES: Record<PasswordViolation, string> = {
  too_short: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Password is too long: the limit is ${PASSWORD_MAX_BYTES} bytes (characters outside basic Latin count for more than one).`,
  matches_identity:
    'Password must not be the same as your email, name or shop name.',
  too_common: 'This password is too common. Choose a less predictable one.',
  breached:
    'This password has appeared in a known data breach. Choose a different one.',
};

const squash = (s: string) => s.toLowerCase().replace(/\s+/g, '');

// Synchronous rules, no network. Exported for unit tests.
export function checkPasswordRules(
  password: string,
  identity: PasswordIdentity = {},
  opts: { skipCommon?: boolean } = {},
): PasswordViolation | null {
  if ([...password].length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (Buffer.byteLength(password, 'utf8') > PASSWORD_MAX_BYTES) {
    return 'too_long';
  }
  const p = squash(password);
  const email = identity.email ? squash(identity.email) : '';
  const candidates = [
    email,
    email.split('@')[0],
    identity.name,
    identity.shopName,
    identity.subdomain,
    identity.phone?.replace(/\D/g, ''),
  ];
  if (candidates.some((c) => c && squash(c) === p)) return 'matches_identity';
  if (!opts.skipCommon) {
    if (COMMON_PASSWORDS.has(p) || /^(.)\1+$/u.test(p)) return 'too_common';
  }
  return null;
}

// The existing e2e suite signs up ~240 times with 'password123' (on any common
// list), and rewriting it would break every concurrently-developed spec, so
// under Jest the common-list and breach layers are off unless
// PASSWORD_POLICY_IN_TESTS=1 (same seam shape as THROTTLE_IN_TESTS: it can only
// re-ENABLE enforcement). Length, byte and identity rules always apply.
function relaxedForTests(): boolean {
  return (
    process.env.NODE_ENV === 'test' &&
    process.env.PASSWORD_POLICY_IN_TESTS !== '1'
  );
}

@Injectable()
export class PasswordPolicyService {
  // Throws a 400 with a stable `code` the admin UI can key off.
  async assertAcceptable(
    password: string,
    identity: PasswordIdentity = {},
  ): Promise<void> {
    const relaxed = relaxedForTests();
    const violation =
      checkPasswordRules(password, identity, { skipCommon: relaxed }) ??
      (!relaxed && (await isBreachedPassword(password)) ? 'breached' : null);
    if (violation) {
      throw new BadRequestException({
        statusCode: 400,
        message: MESSAGES[violation],
        error: 'Bad Request',
        code: `password_${violation}`,
      });
    }
  }
}

@Global()
@Module({
  providers: [PasswordPolicyService],
  exports: [PasswordPolicyService],
})
export class PasswordPolicyModule {}
