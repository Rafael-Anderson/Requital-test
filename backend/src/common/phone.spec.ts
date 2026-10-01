import { normalizePhoneToE164 } from './phone';

// Outputs of the ORIGINAL (pre-countryCode) normalizePhoneToE164, captured
// from the code at origin/main before the change and pasted as literals. Every
// AE and NULL-country shop must keep producing exactly these: customers are
// keyed on [shopId, phone], so a changed output would split one customer in two.
const LEGACY_CORPUS: ReadonlyArray<readonly [string, string | null]> = [
  ['0501234567', '+971501234567'],
  ['501234567', '+971501234567'],
  ['+971501234567', '+971501234567'],
  ['971501234567', '+971501234567'],
  ['00971501234567', '+971501234567'],
  ['050 123 4567', '+971501234567'],
  ['050-123-4567', '+971501234567'],
  ['(050) 123-4567', '+971501234567'],
  ['+971 50 123 4567', '+971501234567'],
  ['00 971 50 123 4567', '+971501234567'],
  ['0551234567', '+971551234567'],
  ['551234567', '+971551234567'],
  ['+14155552671', '+14155552671'],
  ['0014155552671', '+14155552671'],
  ['  0501234567  ', '+971501234567'],
  ['0', null],
  ['', null],
  ['12', null],
  ['not-a-phone', null],
  ['971', null],
  ['9715', null],
  ['97150123', '+97150123'],
  ['05012345', '+9715012345'],
  ['+9715', null],
  ['0971501234567', '+971971501234567'],
  ['971971501234567', '+971971501234567'],
  ['9660551234567', null],
  ['966551234567', '+971966551234567'],
  ['96512345', '+97196512345'],
  ['12345678', '+97112345678'],
  ['123456789012345', null],
  ['1234567890123456', null],
  ['+', null],
  ['00', null],
  ['++971501234567', null],
  ['050.123.4567', null],
  ['٠٥٠١٢٣٤٥٦٧', null],
  ['0501234567x', null],
];

describe('normalizePhoneToE164 legacy corpus (AE and NULL countryCode)', () => {
  it.each(LEGACY_CORPUS)('%j -> %j with no countryCode', (raw, expected) => {
    expect(normalizePhoneToE164(raw)).toBe(expected);
  });
  it.each(LEGACY_CORPUS)('%j -> %j with countryCode NULL', (raw, expected) => {
    expect(normalizePhoneToE164(raw, null)).toBe(expected);
  });
  it.each(LEGACY_CORPUS)('%j -> %j with countryCode AE', (raw, expected) => {
    expect(normalizePhoneToE164(raw, 'AE')).toBe(expected);
  });
  it('an unknown countryCode keeps the legacy behaviour', () => {
    expect(normalizePhoneToE164('0501234567', 'XX')).toBe('+971501234567');
    expect(normalizePhoneToE164('0501234567', 'constructor')).toBe(
      '+971501234567',
    );
  });
});

describe('normalizePhoneToE164 per shop country', () => {
  it.each([
    ['SA', '0551234567', '+966551234567'],
    ['SA', '551234567', '+966551234567'],
    ['SA', '966551234567', '+966551234567'],
    ['SA', '+966551234567', '+966551234567'],
    ['SA', '00966551234567', '+966551234567'],
    ['SA', '055 123 4567', '+966551234567'],
    ['KW', '50012345', '+96550012345'],
    ['KW', '96512345', '+96596512345'],
    ['KW', '96550012345', '+96550012345'],
    ['QA', '55123456', '+97455123456'],
    ['BH', '36123456', '+97336123456'],
    ['OM', '92123456', '+96892123456'],
    ['OM', '0096892123456', '+96892123456'],
    ['SA', '+971501234567', '+971501234567'],
  ])('%s: %s -> %s', (country, raw, expected) => {
    expect(normalizePhoneToE164(raw, country)).toBe(expected);
  });
});

describe('normalizePhoneToE164', () => {
  it('prefixes a local UAE number with a leading 0', () => {
    expect(normalizePhoneToE164('0501234567')).toBe('+971501234567');
  });

  it('prefixes a bare local UAE number with no leading 0', () => {
    expect(normalizePhoneToE164('501234567')).toBe('+971501234567');
  });

  it('leaves an already-E.164 UAE number unchanged', () => {
    expect(normalizePhoneToE164('+971501234567')).toBe('+971501234567');
  });

  it('leaves an already-E.164 non-UAE number unchanged', () => {
    expect(normalizePhoneToE164('+14155552671')).toBe('+14155552671');
  });

  it('normalizes a 00-prefixed international dial format', () => {
    expect(normalizePhoneToE164('00971501234567')).toBe('+971501234567');
  });

  it('strips spaces, hyphens, and parentheses before normalizing', () => {
    expect(normalizePhoneToE164('050 123 4567')).toBe('+971501234567');
    expect(normalizePhoneToE164('(050) 123-4567')).toBe('+971501234567');
  });

  it('passes through digits that already include the UAE country code with no +', () => {
    expect(normalizePhoneToE164('971501234567')).toBe('+971501234567');
  });

  it('returns null for malformed/non-numeric input', () => {
    expect(normalizePhoneToE164('not-a-phone')).toBeNull();
    expect(normalizePhoneToE164('12')).toBeNull();
    expect(normalizePhoneToE164('')).toBeNull();
  });
});
