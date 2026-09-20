// A static list of well-known throwaway-inbox providers, checked at signup.
//
// Deliberately NOT a third-party reputation API, a background-refreshed feed
// or a scored heuristic: this exists to stop scripted bulk shop creation with
// disposable addresses, not to win an arms race against a determined attacker
// (who will register a domain). A list in a file has no runtime dependency, no
// key to rotate and no outage mode, and the cost of it going slightly stale is
// that one more throwaway domain gets through - which the signup rate limit
// still slows down.
//
// Matching is on the exact domain or any subdomain of it, lowercased. Add to
// the list rather than reaching for a smarter mechanism.
const DISPOSABLE_EMAIL_DOMAINS = new Set([
  '0-mail.com',
  '10minutemail.com',
  '20minutemail.com',
  '33mail.com',
  'anonbox.net',
  'byom.de',
  'dispostable.com',
  'dropmail.me',
  'e4ward.com',
  'emailondeck.com',
  'fakeinbox.com',
  'fakemailgenerator.com',
  'getairmail.com',
  'getnada.com',
  'guerrillamail.com',
  'guerrillamail.net',
  'guerrillamail.org',
  'harakirimail.com',
  'inboxbear.com',
  'jetable.org',
  'mail-temporaire.fr',
  'mail7.io',
  'mailcatch.com',
  'maildrop.cc',
  'mailinator.com',
  'mailnesia.com',
  'mailsac.com',
  'mintemail.com',
  'mohmal.com',
  'moakt.com',
  'mytemp.email',
  'sharklasers.com',
  'spam4.me',
  'spamgourmet.com',
  'temp-mail.org',
  'tempail.com',
  'tempinbox.com',
  'tempmail.net',
  'tempmailo.com',
  'throwawaymail.com',
  'trashmail.com',
  'trashmail.de',
  'yopmail.com',
  'yopmail.fr',
  'yopmail.net',
]);

// The address is already shape-validated by @IsEmail on the DTO by the time
// this runs, so this only has to pull the domain off and look it up. A value
// with no `@` (or nothing after it) is not this check's problem and passes.
export function isDisposableEmailDomain(email: string): boolean {
  const at = email.lastIndexOf('@');
  if (at === -1) return false;
  const domain = email
    .slice(at + 1)
    .trim()
    .toLowerCase();
  if (!domain) return false;
  if (DISPOSABLE_EMAIL_DOMAINS.has(domain)) return true;
  // A subdomain of a blocked domain is the same inbox provider
  // (foo.mailinator.com), but a domain merely ENDING in one is not
  // (notmailinator.com), hence the explicit dot.
  return [...DISPOSABLE_EMAIL_DOMAINS].some((blocked) =>
    domain.endsWith(`.${blocked}`),
  );
}

export const DISPOSABLE_EMAIL_MESSAGE =
  'Sign up with a permanent email address. Disposable inboxes are not accepted.';
