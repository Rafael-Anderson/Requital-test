import { defaultReturnRefundMinor, orderIsTaxInclusive } from './return-refund';

// A 100 x2 (5% tax), B 50 x1 (0%), 10% code: gross 250, discount 25, tax 9.
const lines = [
  { id: 1, quantity: 2, priceAtPurchase: '100', taxRate: '5', taxAmount: '9' },
  { id: 2, quantity: 1, priceAtPurchase: '50', taxRate: '0', taxAmount: '0' },
];
const excl = {
  total: '234',
  deliveryFee: null,
  discountAmount: '25',
  taxAmount: '9',
  currency: 'AED',
};

describe('defaultReturnRefundMinor', () => {
  it('refunds the discounted line plus its tax on an exclusive order', () => {
    expect(
      defaultReturnRefundMinor({
        order: excl,
        orderLines: lines,
        priorReturned: new Map(),
        returning: [{ orderItemId: 1, quantity: 1 }],
      }),
    ).toBe(9450);
  });

  it('does not add tax on an inclusive order', () => {
    // inclusive: the same prices already contain the tax, total = 250 - 25
    const incl = { ...excl, total: '225' };
    expect(orderIsTaxInclusive(incl, lines)).toBe(true);
    expect(orderIsTaxInclusive(excl, lines)).toBe(false);
    expect(
      defaultReturnRefundMinor({
        order: incl,
        orderLines: lines,
        priorReturned: new Map(),
        returning: [{ orderItemId: 1, quantity: 1 }],
      }),
    ).toBe(9000);
  });

  it('telescopes: any split of the lines sums exactly to the whole', () => {
    // 3 units at 3.33 with a 0.10 discount: per-unit shares do not divide evenly.
    const odd = [
      {
        id: 7,
        quantity: 3,
        priceAtPurchase: '3.33',
        taxRate: '5',
        taxAmount: '0.48',
      },
    ];
    const order = {
      total: '10.37',
      deliveryFee: null,
      discountAmount: '0.10',
      taxAmount: '0.48',
      currency: 'AED',
    };
    let sum = 0;
    const prior = new Map<number, number>();
    for (let i = 0; i < 3; i++) {
      sum += defaultReturnRefundMinor({
        order,
        orderLines: odd,
        priorReturned: new Map(prior),
        returning: [{ orderItemId: 7, quantity: 1 }],
      })!;
      prior.set(7, i + 1);
    }
    const whole = defaultReturnRefundMinor({
      order,
      orderLines: odd,
      priorReturned: new Map(),
      returning: [{ orderItemId: 7, quantity: 3 }],
    });
    expect(sum).toBe(whole);
  });

  it('uses the currency minor unit (KWD keeps three decimals)', () => {
    const kwd = [
      {
        id: 1,
        quantity: 1,
        priceAtPurchase: '10.505',
        taxRate: '0',
        taxAmount: '0',
      },
    ];
    expect(
      defaultReturnRefundMinor({
        order: {
          total: '10.505',
          deliveryFee: null,
          discountAmount: null,
          taxAmount: '0',
          currency: 'KWD',
        },
        orderLines: kwd,
        priorReturned: new Map(),
        returning: [{ orderItemId: 1, quantity: 1 }],
      }),
    ).toBe(10505);
  });

  it('returns null when the captured tax is NULL (legacy: unknown)', () => {
    expect(
      defaultReturnRefundMinor({
        order: excl,
        orderLines: lines.map((l) => ({
          ...l,
          taxAmount: null,
          taxRate: null,
        })),
        priorReturned: new Map(),
        returning: [{ orderItemId: 1, quantity: 1 }],
      }),
    ).toBeNull();
  });
});
