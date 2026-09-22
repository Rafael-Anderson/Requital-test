import {
  DEFAULT_MINOR_UNIT_FACTOR,
  minorUnitFactor,
  toMinorUnits,
} from './currency-minor-units';

describe('minorUnitFactor', () => {
  it('is 100 for the two-decimal currencies this platform offers', () => {
    for (const code of ['AED', 'SAR', 'QAR', 'USD']) {
      expect(minorUnitFactor(code)).toBe(100);
    }
  });

  // The whole reason this module exists. ISO 4217 gives these an exponent of 3.
  it('is 1000 for the three-decimal Gulf currencies', () => {
    for (const code of ['KWD', 'BHD', 'OMR']) {
      expect(minorUnitFactor(code)).toBe(1000);
    }
  });

  it('is case- and whitespace-insensitive', () => {
    expect(minorUnitFactor('kwd')).toBe(1000);
    expect(minorUnitFactor(' KWD ')).toBe(1000);
    expect(minorUnitFactor('Aed')).toBe(100);
  });

  // An unknown code behaves exactly as the codebase did before this module,
  // rather than throwing or inventing a new failure mode.
  it('falls back to 100 for an unknown, null or empty currency', () => {
    expect(minorUnitFactor('ZZZ')).toBe(DEFAULT_MINOR_UNIT_FACTOR);
    expect(minorUnitFactor(null)).toBe(DEFAULT_MINOR_UNIT_FACTOR);
    expect(minorUnitFactor(undefined)).toBe(DEFAULT_MINOR_UNIT_FACTOR);
    expect(minorUnitFactor('')).toBe(DEFAULT_MINOR_UNIT_FACTOR);
  });
});

describe('toMinorUnits', () => {
  // The reachable path today: shop.currency is locked to AED.
  it('converts a two-decimal amount with a factor of 100', () => {
    expect(toMinorUnits(199, 'AED')).toBe(19900);
    expect(toMinorUnits(199.99, 'AED')).toBe(19999);
    expect(toMinorUnits(0.05, 'AED')).toBe(5);
  });

  // The bug this replaces: the old code did `Math.round(amount * 100)`
  // unconditionally, so 10.5 KWD went to Stripe as 1050 minor units - 1.050 KWD,
  // a 10x undercharge. It must now be 10500.
  it('converts a three-decimal amount with a factor of 1000', () => {
    expect(toMinorUnits(10.5, 'KWD')).toBe(10500);
    expect(toMinorUnits(10.5, 'BHD')).toBe(10500);
    expect(toMinorUnits(10.5, 'OMR')).toBe(10500);
    // What the old unconditional x100 would have produced, stated explicitly so
    // a regression is obvious rather than subtle.
    expect(toMinorUnits(10.5, 'KWD')).not.toBe(Math.round(10.5 * 100));
  });

  it('keeps the third decimal of a three-decimal currency', () => {
    expect(toMinorUnits(1.234, 'KWD')).toBe(1234);
    // Two-decimal currencies cannot represent that third digit, so it rounds.
    expect(toMinorUnits(1.234, 'AED')).toBe(123);
  });

  it('always returns an integer, since a fractional minor unit is not payable', () => {
    for (const [amount, code] of [
      [1.005, 'AED'],
      [1.0005, 'KWD'],
      [0.014, 'AED'],
    ] as const) {
      expect(Number.isInteger(toMinorUnits(amount, code))).toBe(true);
    }
  });

  // Rounds rather than truncates: truncating loses a fils on every fractional
  // amount, always in the merchant's disfavour.
  it('rounds rather than truncating', () => {
    expect(toMinorUnits(1.999, 'AED')).toBe(200);
    expect(toMinorUnits(1.9999, 'KWD')).toBe(2000);
  });

  it('handles zero and does not produce negative zero', () => {
    expect(toMinorUnits(0, 'AED')).toBe(0);
    expect(Object.is(toMinorUnits(0, 'AED'), -0)).toBe(false);
  });
});
