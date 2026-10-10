import { BadRequestException } from '@nestjs/common';
import { decimalToMinor, minorToDecimal, parseAdminAmount } from './store-credit-money';

describe('store credit money', () => {
  it('round-trips every supported currency exactly, with no float', () => {
    expect(decimalToMinor('12.500', 'AED')).toBe(1250);
    expect(decimalToMinor('12.500', 'KWD')).toBe(12500);
    expect(decimalToMinor('0.010', 'AED')).toBe(1);
    expect(decimalToMinor('-3.250', 'AED')).toBe(-325);
    expect(minorToDecimal(1250, 'AED')).toBe('12.50');
    expect(minorToDecimal(12505, 'KWD')).toBe('12.505');
    expect(minorToDecimal(-5, 'AED')).toBe('-0.05');
    expect(minorToDecimal(5, 'KWD')).toBe('0.005');
    // a value float arithmetic gets wrong: 0.1 + 0.2 in minor units is exactly 30
    expect(decimalToMinor('0.100', 'AED') + decimalToMinor('0.200', 'AED')).toBe(30);
  });

  it('refuses a row with more precision than the currency has', () => {
    expect(() => decimalToMinor('1.005', 'AED')).toThrow(/precision/);
  });

  it('accepts a sane admin amount and rejects the rest', () => {
    expect(parseAdminAmount(10.5, 'AED')).toBe(1050);
    expect(parseAdminAmount('10.505', 'KWD')).toBe(10505);
    for (const bad of ['10.505', 0, '0', -1, '-1', 'abc', '1e3', 1e21, null, undefined, '', '12345678', '1000000.001']) {
      expect(() => parseAdminAmount(bad, 'AED')).toThrow(BadRequestException);
    }
    expect(() => parseAdminAmount('1000000', 'AED')).not.toThrow();
    expect(() => parseAdminAmount('1000000.01', 'AED')).toThrow(/exceed/);
  });
});
