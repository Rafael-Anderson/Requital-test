import {
  normalizeSendingDomain,
  platformViaDisplayName,
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

describe('sanitizeDisplayName invisible controls', () => {
  it.each([
    '\u202e',
    '\u200b',
    '\u200f',
    '\u2066',
    '\u2069',
    '\ufeff',
    '\u0085',
  ])('strips %j', (c) => {
    const out = sanitizeDisplayName(`Ro${c}ses`);
    expect(out).toBe('Ro ses');
  });
});

describe('platformViaDisplayName (shop name on the platform domain)', () => {
  it.each([
    ['Rose Shop', 'Rose Shop via Requital'],
    ['Mr. Roses', 'Mr. Roses via Requital'],
    ['متجر الورد', 'متجر الورد via Requital'],
    ['support@paypal.com', 'support via Requital'],
    ['PayPal Support www.evil.com', 'PayPal Support via Requital'],
    ['Visit https://evil.example/login now', 'Visit now via Requital'],
    ['paypal.com', 'Store via Requital'],
    ['paypal\u3002com Help', 'Help via Requital'],
    ['a@b', 'a b via Requital'],
    ['\u202egnihtoN', 'gnihtoN via Requital'],
    ['', 'Store via Requital'],
  ])('%j -> %j', (input, expected) => {
    expect(platformViaDisplayName(input)).toBe(expected);
  });

  it('never exceeds 78 characters in total', () => {
    expect(platformViaDisplayName('x'.repeat(200)).length).toBe(78);
  });

  it('never leaves an @, a link or a dot-TLD token', () => {
    for (const n of ['ceo@requital.io', 'WWW.X.COM', 'http://a', 'a.b.cc d']) {
      expect(platformViaDisplayName(n)).not.toMatch(
        /@|https?:|www\.|\w\.\w{2,}/i,
      );
    }
  });
});
