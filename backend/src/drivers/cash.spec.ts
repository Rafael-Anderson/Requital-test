import { decimalToMinor, minorToDecimal, parseCashInput } from './cash';

describe('driver cash helpers (exact decimal arithmetic)', () => {
  it('reads the DECIMAL(65,30) strings mysql2 returns', () => {
    expect(decimalToMinor('141.290000000000000000000000000000', 'AED')).toBe(
      14129,
    );
    expect(decimalToMinor('31.515000000000000000000000000000', 'KWD')).toBe(
      31515,
    );
    expect(decimalToMinor('100', 'AED')).toBe(10000);
  });

  it('does not suffer the float 1.005 problem', () => {
    // Number('1.005') * 100 === 100.49999999999999
    expect(decimalToMinor('1.005', 'AED')).toBe(101);
    expect(decimalToMinor('1.004', 'AED')).toBe(100);
    expect(decimalToMinor('1.005', 'KWD')).toBe(1005);
  });

  it('round-trips to the currency decimals', () => {
    expect(minorToDecimal(14129, 'AED')).toBe('141.29');
    expect(minorToDecimal(5, 'AED')).toBe('0.05');
    expect(minorToDecimal(31515, 'KWD')).toBe('31.515');
    expect(minorToDecimal(0, 'KWD')).toBe('0.000');
  });

  it('parses a driver-typed amount strictly', () => {
    expect(parseCashInput('141.29', 'AED')).toBe(14129);
    expect(parseCashInput(141.29, 'AED')).toBe(14129);
    expect(parseCashInput('141', 'AED')).toBe(14100);
    expect(parseCashInput('10.505', 'KWD')).toBe(10505);
    expect(parseCashInput('10.505', 'AED')).toBeNull(); // three places in a 2dp currency
    for (const bad of [
      '-1',
      '1e3',
      '1,5',
      '',
      ' ',
      'abc',
      '1.',
      '.5',
      null,
      undefined,
      {},
      NaN,
      Infinity,
    ]) {
      expect(parseCashInput(bad, 'AED')).toBeNull();
    }
  });
});
