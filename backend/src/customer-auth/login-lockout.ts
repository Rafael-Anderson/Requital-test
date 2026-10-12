// Progressive per-account delay after repeated wrong passwords. Mirrors
// AuthService's constants by hand (this tier is deliberately separate from staff
// auth). Shared inside the customer tier by login and by the profile email
// change, which also checks a password.
export const LOGIN_LOCKOUT_THRESHOLD = 5;
const LOGIN_LOCKOUT_BASE_DELAY_SECONDS = 2;
const LOGIN_LOCKOUT_MAX_DELAY_SECONDS = 60;

export function isWithinLoginCooldown(customer: {
  failedLoginAttempts: number;
  lastFailedLoginAt: Date | null;
}): boolean {
  if (
    customer.failedLoginAttempts < LOGIN_LOCKOUT_THRESHOLD ||
    !customer.lastFailedLoginAt
  ) {
    return false;
  }
  const delaySeconds = Math.min(
    LOGIN_LOCKOUT_MAX_DELAY_SECONDS,
    LOGIN_LOCKOUT_BASE_DELAY_SECONDS **
      (customer.failedLoginAttempts - LOGIN_LOCKOUT_THRESHOLD + 1),
  );
  return Date.now() - customer.lastFailedLoginAt.getTime() < delaySeconds * 1000;
}
