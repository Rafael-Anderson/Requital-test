import {
  normalizeSendingDomain,
  sanitizeDisplayName,
  sendingDomainProblem,
} from './sending-domain-validation';

describe('sendingDomainProblem', () => {
  it.each(['roses.com', 'mail.roses.com', 'my-shop.co.ae', 'xn--abc.com'])(
    'accepts %s',
    (d) => expect(sendingDomainProblem(d)).toBeNull(),
  );

  it.each([
    'requital.io',
    'mail.requital.io',
    'a.b.requital.io',
    'gmail.com',
    'mail.gmail.com',
    'outlook.com',
    'yahoo.com',
    'icloud.com',
    'co.uk',
    'com.sa',
    'co.ae',
    'localhost',
    'com',
    '-bad.com',
    'bad-.com',
    'a b.com',
    'http://roses.com',
    'roses.com/path',
    'roses.com:25',
    'user@roses.com',
    '',
    `${'a'.repeat(64)}.com`,
  ])('rejects %j', (d) => expect(sendingDomainProblem(d)).not.toBeNull());

  it('normalises case, whitespace and a trailing dot before validating', () => {
    expect(normalizeSendingDomain('  Mail.Roses.COM. ')).toBe('mail.roses.com');
  });

  it('is not fooled by a lookalike of the platform domain', () => {
    expect(sendingDomainProblem('notrequital.io')).toBeNull();
    expect(sendingDomainProblem('requital.io.evil.com')).toBeNull();
  });
});

describe('sanitizeDisplayName', () => {
  it('strips CR/LF, quotes, backslashes and angle brackets', () => {
    expect(sanitizeDisplayName('A\r\nB')).toBe('A B');
    expect(sanitizeDisplayName('He said "hi" \\ <x>')).toBe('He said hi x');
  });
  it('falls back to Requital when nothing is left', () => {
    expect(sanitizeDisplayName('"\r\n')).toBe('Requital');
    expect(sanitizeDisplayName(null)).toBe('Requital');
  });
  it('keeps Arabic and caps the length', () => {
    expect(sanitizeDisplayName('متجر الورد')).toBe('متجر الورد');
    expect(sanitizeDisplayName('x'.repeat(200)).length).toBe(78);
  });
});
