import {
  splitName,
  verifyObservedPayment,
  withQuery,
} from './nomod-payment.service';

const row = { amountMinor: 10_000, currency: 'AED' };
const order = {
  currency: 'AED',
  total: '100.00',
  giftCardAmount: null,
  storeCreditAmount: null,
};

describe('verifyObservedPayment', () => {
  it('accepts the exact amount and currency', () => {
    expect(
      verifyObservedPayment(row, order, {
        currency: 'aed',
        totalMinor: 10_000,
      }),
    ).toEqual({ ok: true });
  });

  it('rejects a different amount (higher and lower)', () => {
    for (const totalMinor of [9_999, 10_001, 1, 0]) {
      expect(
        verifyObservedPayment(row, order, { currency: 'AED', totalMinor }),
      ).toEqual({ ok: false, reason: 'amount_mismatch' });
    }
  });

  it('rejects a different currency', () => {
    expect(
      verifyObservedPayment(row, order, {
        currency: 'USD',
        totalMinor: 10_000,
      }),
    ).toEqual({ ok: false, reason: 'currency_mismatch' });
  });

  it('rejects an event with no currency or no amount', () => {
    expect(
      verifyObservedPayment(row, order, { currency: null, totalMinor: 10_000 }),
    ).toEqual({ ok: false, reason: 'currency_missing' });
    expect(
      verifyObservedPayment(row, order, { currency: 'AED', totalMinor: null }),
    ).toEqual({ ok: false, reason: 'amount_missing' });
  });

  it('rejects when the order changed since the checkout was made', () => {
    expect(
      verifyObservedPayment(
        row,
        { ...order, total: '90.00' },
        { currency: 'AED', totalMinor: 10_000 },
      ),
    ).toEqual({ ok: false, reason: 'order_amount_changed' });
    expect(
      verifyObservedPayment(
        row,
        { ...order, currency: 'SAR' },
        { currency: 'AED', totalMinor: 10_000 },
      ),
    ).toEqual({ ok: false, reason: 'order_currency_changed' });
  });

  it('compares against what is DUE, after a gift card and store credit', () => {
    const due = {
      ...order,
      giftCardAmount: '20.00',
      storeCreditAmount: '5.00',
    };
    expect(
      verifyObservedPayment({ amountMinor: 7_500, currency: 'AED' }, due, {
        currency: 'AED',
        totalMinor: 7_500,
      }),
    ).toEqual({ ok: true });
  });

  it('a BIGINT arriving as a string still compares as a number', () => {
    expect(
      verifyObservedPayment(
        { amountMinor: '10000' as unknown as number, currency: 'AED' },
        order,
        { currency: 'AED', totalMinor: 10_000 },
      ),
    ).toEqual({ ok: true });
  });
});

describe('helpers', () => {
  it('splitName', () => {
    expect(splitName('Aisha Khan')).toEqual({ first: 'Aisha', last: 'Khan' });
    expect(splitName('Aisha')).toEqual({ first: 'Aisha', last: '-' });
    expect(splitName('Mary Jane Watson')).toEqual({
      first: 'Mary',
      last: 'Jane Watson',
    });
    expect(splitName('   ')).toEqual({ first: 'Customer', last: '-' });
  });

  it('withQuery keeps the existing query and sets the flag', () => {
    expect(
      withQuery('https://s.test/checkout?orderId=5', 'payment', 'failed'),
    ).toBe('https://s.test/checkout?orderId=5&payment=failed');
    expect(withQuery('not a url', 'payment', 'failed')).toBe('not a url');
  });
});
