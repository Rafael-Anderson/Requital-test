import {
  DEFAULT_MINOR_UNIT_FACTOR,
  minorUnitDecimals,
  minorUnitFactor,
  roundMoney,
  toMajorUnitString,
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

describe('minorUnitDecimals', () => {
  it('derives the decimal count from the factor, not a second map', () => {
    expect(minorUnitDecimals('AED')).toBe(2);
    expect(minorUnitDecimals('USD')).toBe(2);
    expect(minorUnitDecimals('KWD')).toBe(3);
    expect(minorUnitDecimals('BHD')).toBe(3);
    expect(minorUnitDecimals('OMR')).toBe(3);
  });

  it('falls back to 2 for an unknown or missing code', () => {
    expect(minorUnitDecimals('XYZ')).toBe(2);
    expect(minorUnitDecimals(null)).toBe(2);
    expect(minorUnitDecimals(undefined)).toBe(2);
  });
});

describe('roundMoney', () => {
  it('rounds to the currency’s own precision, not a hardcoded 2', () => {
    expect(roundMoney(10.555, 'AED')).toBeCloseTo(10.56, 10);
    // The case a hardcoded .toFixed(2) silently destroys: the third decimal is
    // a real, chargeable amount in KWD.
    expect(roundMoney(10.5555, 'KWD')).toBeCloseTo(10.556, 10);
    expect(roundMoney(10.5554, 'KWD')).toBeCloseTo(10.555, 10);
  });

  it('kills the binary-float tail that was being persisted raw', () => {
    // 0.1 + 0.2 === 0.30000000000000004. The admin order paths wrote exactly
    // this kind of value straight into DECIMAL(65,30).
    expect(roundMoney(0.1 + 0.2, 'AED')).toBe(0.3);
    expect(roundMoney(4.999999999999999, 'AED')).toBe(5);
  });

  it('is idempotent — rounding an already-rounded amount changes nothing', () => {
    for (const [amount, currency] of [
      [10.56, 'AED'],
      [10.556, 'KWD'],
      [0, 'AED'],
    ] as const) {
      expect(roundMoney(roundMoney(amount, currency), currency)).toBe(
        roundMoney(amount, currency),
      );
    }
  });

  it('rounds the SUM, which is not the same as summing rounded lines', () => {
    // The documented policy, pinned as a test because it is the part a future
    // edit is most likely to get wrong. Three lines of 0.005 each:
    const lines = [0.005, 0.005, 0.005];
    const roundedSum = roundMoney(
      lines.reduce((a, b) => a + b, 0),
      'AED',
    );
    const sumOfRounded = lines
      .map((l) => roundMoney(l, 'AED'))
      .reduce((a, b) => a + b, 0);
    expect(roundedSum).toBe(0.02);
    expect(sumOfRounded).toBe(0.03);
    // They genuinely differ — which is why the policy has to be stated rather
    // than left to each call site.
    expect(roundedSum).not.toBe(sumOfRounded);
  });
});

describe('toMajorUnitString', () => {
  it('serialises with the currency’s own decimal count', () => {
    expect(toMajorUnitString(10.5, 'AED')).toBe('10.50');
    // "10.50" would be read by the provider as a different amount than 10.500.
    expect(toMajorUnitString(10.5, 'KWD')).toBe('10.500');
    expect(toMajorUnitString(10.5, 'BHD')).toBe('10.500');
  });

  it('rounds before formatting rather than letting toFixed truncate oddly', () => {
    expect(toMajorUnitString(10.5555, 'KWD')).toBe('10.556');
    expect(toMajorUnitString(0.1 + 0.2, 'AED')).toBe('0.30');
  });

  it('agrees with toMinorUnits — the two must never disagree', () => {
    // Both derive from the same factor map; this pins that they stay consistent,
    // since a charge serialised one way and converted the other is a real
    // money bug.
    for (const currency of ['AED', 'KWD', 'BHD', 'USD']) {
      const amount = 12.3456;
      const asString = toMajorUnitString(amount, currency);
      expect(toMinorUnits(Number(asString), currency)).toBe(
        toMinorUnits(amount, currency),
      );
    }
  });
});
