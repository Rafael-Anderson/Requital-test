import { isDisposableEmailDomain } from './disposable-email-domains';

describe('isDisposableEmailDomain', () => {
  it('blocks a known throwaway provider', () => {
    expect(isDisposableEmailDomain('someone@mailinator.com')).toBe(true);
    expect(isDisposableEmailDomain('a@guerrillamail.com')).toBe(true);
    expect(isDisposableEmailDomain('a@yopmail.fr')).toBe(true);
  });

  it('blocks a subdomain of one, which is the same inbox provider', () => {
    expect(isDisposableEmailDomain('someone@team.mailinator.com')).toBe(true);
  });

  // The reason the check uses an explicit dot rather than a bare endsWith:
  // a real business could plausibly own a domain that merely ends in one of
  // these strings, and refusing their signup would be worse than letting a
  // throwaway through.
  it('does not block a domain that merely ends with a blocked one', () => {
    expect(isDisposableEmailDomain('someone@notmailinator.com')).toBe(false);
    expect(isDisposableEmailDomain('someone@mymaildrop.cc')).toBe(false);
  });

  it('ignores case and surrounding whitespace', () => {
    expect(isDisposableEmailDomain('Someone@MAILINATOR.com')).toBe(true);
    expect(isDisposableEmailDomain('someone@mailinator.com ')).toBe(true);
  });

  it('allows an ordinary address', () => {
    expect(isDisposableEmailDomain('owner@arabianpetals.ae')).toBe(false);
    expect(isDisposableEmailDomain('owner@gmail.com')).toBe(false);
  });

  // Shape is @IsEmail's job; this must not throw on whatever reaches it.
  it('passes anything that is not an address rather than throwing', () => {
    expect(isDisposableEmailDomain('not-an-email')).toBe(false);
    expect(isDisposableEmailDomain('trailing@')).toBe(false);
    expect(isDisposableEmailDomain('')).toBe(false);
  });

  // A plus-addressed throwaway is still a throwaway; the domain is what is
  // matched, not the local part.
  it('is not fooled by plus-addressing or a local part containing an @', () => {
    expect(isDisposableEmailDomain('a+tag@mailinator.com')).toBe(true);
    expect(isDisposableEmailDomain('"weird@local"@mailinator.com')).toBe(true);
  });
});
