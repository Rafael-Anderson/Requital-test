import { normalizePhoneToE164 } from './phone';

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
