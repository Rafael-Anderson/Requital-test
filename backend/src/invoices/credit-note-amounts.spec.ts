import {
  computeReturnCredit,
  CreditNoteTaxUnknownError,
  type OrderLineForCredit,
} from './credit-note-amounts';

const lines = (taxed = true): OrderLineForCredit[] => [
  { id: 1, quantity: 2, priceAtPurchase: '50', taxRate: taxed ? '5' : null, taxAmount: taxed ? '5' : null },
  { id: 2, quantity: 1, priceAtPurchase: '100', taxRate: taxed ? '0' : null, taxAmount: taxed ? '0' : null },
];

describe('computeReturnCredit', () => {
  it('credits the returned units pro rata from the captured per-line tax (exclusive)', () => {
    // 1 of 2 units of line 1: 50 gross, half of its 5 tax = 2.50.
    const c = computeReturnCredit({
      orderLines: lines(),
      returned: [{ orderItemId: 1, quantity: 1 }],
      discountAmount: null,
      taxInclusive: false,
      currency: 'AED',
    });
    expect(c).toMatchObject({ subtotal: 50, discountAmount: 0, taxAmount: 2.5, total: 52.5 });
    expect(c.lines[0]).toMatchObject({ orderItemId: 1, quantity: 1, taxRate: 5, taxAmount: 2.5 });
  });

  it('inclusive pricing: the tax is a component of the total, not an addend', () => {
    const c = computeReturnCredit({
      orderLines: lines(),
      returned: [{ orderItemId: 1, quantity: 1 }],
      discountAmount: null,
      taxInclusive: true,
      currency: 'AED',
    });
    expect(c.total).toBe(50);
    expect(c.taxAmount).toBe(2.5);
  });

  it('apportions the order discount by gross share of the credited lines', () => {
    // gross 200, discount 20 -> returning 50 gross takes 5 of the discount.
    const c = computeReturnCredit({
      orderLines: lines(),
      returned: [{ orderItemId: 1, quantity: 1 }],
      discountAmount: '20',
      taxInclusive: false,
      currency: 'AED',
    });
    expect(c.discountAmount).toBe(5);
    expect(c.total).toBe(50 - 5 + 2.5);
  });

  it('keeps a third decimal for KWD', () => {
    const c = computeReturnCredit({
      orderLines: [{ id: 1, quantity: 3, priceAtPurchase: '10.505', taxRate: '5', taxAmount: '1.576' }],
      returned: [{ orderItemId: 1, quantity: 1 }],
      discountAmount: null,
      taxInclusive: false,
      currency: 'KWD',
    });
    expect(c.subtotal).toBe(10.505);
    expect(c.taxAmount).toBe(0.525); // 1.576 / 3 = 0.52533 -> 3dp
    expect(c.total).toBe(11.03);
  });

  it('NULL captured tax is unknown: throws instead of inventing a figure', () => {
    expect(() =>
      computeReturnCredit({
        orderLines: lines(false),
        returned: [{ orderItemId: 1, quantity: 1 }],
        discountAmount: null,
        taxInclusive: false,
        currency: 'AED',
      }),
    ).toThrow(CreditNoteTaxUnknownError);
  });

  it('a zero-tax captured line is KNOWN zero and is credited', () => {
    const c = computeReturnCredit({
      orderLines: lines(),
      returned: [{ orderItemId: 2, quantity: 1 }],
      discountAmount: null,
      taxInclusive: false,
      currency: 'AED',
    });
    expect(c).toMatchObject({ subtotal: 100, taxAmount: 0, total: 100 });
  });
});
