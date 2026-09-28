import { formatMoney } from './money-format';

describe('formatMoney', () => {
  it('uses the currency code, not a symbol', () => {
    expect(formatMoney(199, 'AED')).toBe('199.00 AED');
  });

  it('uses the currency’s own decimal width, not a hardcoded 2', () => {
    // "10.50 KWD" would be a different amount from "10.500 KWD".
    expect(formatMoney(10.5, 'KWD')).toBe('10.500 KWD');
    expect(formatMoney(10.5, 'BHD')).toBe('10.500 BHD');
    expect(formatMoney(10.5, 'AED')).toBe('10.50 AED');
  });

  it('accepts the DECIMAL strings mysql2 returns, not just numbers', () => {
    // Every money column comes back as a string from the driver.
    expect(formatMoney('199.000000000000000000000000000000', 'AED')).toBe(
      '199.00 AED',
    );
  });

  it('never renders NaN into something a customer reads', () => {
    expect(formatMoney('not-a-number', 'AED')).toBe('AED');
    expect(formatMoney(Number.NaN, 'AED')).toBe('AED');
  });

  it('degrades to a bare amount rather than a dangling space with no code', () => {
    expect(formatMoney(199, null)).toBe('199.00');
    expect(formatMoney(199, '')).toBe('199.00');
  });
});
