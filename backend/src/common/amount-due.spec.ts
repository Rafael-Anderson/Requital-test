import { amountDueDecimal, amountDueMinor } from './amount-due';

describe('amountDueMinor', () => {
  it('subtracts gift card and store credit in the order currency minor units', () => {
    expect(
      amountDueMinor({
        total: '100.000000000000000000000000000000',
        giftCardAmount: '20',
        storeCreditAmount: '30.5',
        currency: 'AED',
      }),
    ).toBe(4950);
  });

  it('is exact to the third decimal for KWD', () => {
    expect(
      amountDueMinor({
        total: '33.091',
        storeCreditAmount: '10.505',
        currency: 'KWD',
      }),
    ).toBe(22586);
    expect(
      amountDueDecimal({ total: '33.091', storeCreditAmount: '10.505', currency: 'KWD' }),
    ).toBe('22.586');
  });

  it('never goes below zero and treats NULL tenders as none', () => {
    expect(amountDueMinor({ total: '20', storeCreditAmount: '25', currency: 'AED' })).toBe(0);
    expect(amountDueMinor({ total: '20', giftCardAmount: null, currency: 'AED' })).toBe(2000);
  });
});
