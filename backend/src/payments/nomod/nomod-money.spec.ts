import {
  NomodAmountError,
  buildNomodAmounts,
  isNomodCurrency,
  lineTotalMinor,
  nomodReferenceId,
  type NomodOrderSnapshot,
} from './nomod-money';

function snap(over: Partial<NomodOrderSnapshot> = {}): NomodOrderSnapshot {
  return {
    currency: 'AED',
    total: '100.00',
    deliveryFee: null,
    taxAmount: null,
    discountAmount: null,
    giftCardAmount: null,
    storeCreditAmount: null,
    lines: [{ id: 1, name: 'Roses', quantity: 2, unitPrice: '50.00' }],
    ...over,
  };
}

// The invariant Nomod checks: amount == sum(items.total_amount) - discount.
function sumItems(a: ReturnType<typeof buildNomodAmounts>): number {
  return a.items.reduce(
    (s, i) => s + Math.round(Number(i.total_amount) * 100),
    0,
  );
}
function check(a: ReturnType<typeof buildNomodAmounts>) {
  const discount = a.discount ? Math.round(Number(a.discount) * 100) : 0;
  expect(sumItems(a) - discount).toBe(Math.round(Number(a.amount) * 100));
  for (const i of a.items) {
    // unit x quantity == total, exactly.
    expect(Math.round(Number(i.unit_amount) * 100) * i.quantity).toBe(
      Math.round(Number(i.total_amount) * 100),
    );
  }
}

describe('lineTotalMinor', () => {
  it('rounds the whole line once, not the unit price per unit', () => {
    // 10.505 x 3 = 31.515 -> 31.52 (3 x round(10.505) would be 31.53)
    expect(lineTotalMinor('10.505', 3, 'AED')).toBe(3152);
  });
  it('is exact for plain prices and long decimals', () => {
    expect(lineTotalMinor('19.99', 3, 'AED')).toBe(5997);
    expect(lineTotalMinor('0.1', 3, 'AED')).toBe(30);
    expect(lineTotalMinor('12.000000000000000000000000000000', 2, 'AED')).toBe(
      2400,
    );
  });
  it('rejects an unreadable price or quantity', () => {
    expect(() => lineTotalMinor('abc', 1, 'AED')).toThrow(NomodAmountError);
    expect(() => lineTotalMinor('1.00', 0, 'AED')).toThrow(NomodAmountError);
    expect(() => lineTotalMinor('-1.00', 1, 'AED')).toThrow(NomodAmountError);
  });
});

describe('buildNomodAmounts', () => {
  it('a plain order: lines only, no discount', () => {
    const a = buildNomodAmounts(snap());
    expect(a.amount).toBe('100.00');
    expect(a.discount).toBeUndefined();
    expect(a.items).toHaveLength(1);
    expect(a.items[0]).toMatchObject({
      item_id: 'line-1',
      quantity: 2,
      unit_amount: '50.00',
      total_amount: '100.00',
      net_amount: '100.00',
      discount_type: 'flat',
      discount_amount: '0.00',
    });
    check(a);
  });

  it('adds a Delivery line', () => {
    const a = buildNomodAmounts(
      snap({ deliveryFee: '15.00', total: '115.00' }),
    );
    expect(a.amount).toBe('115.00');
    expect(a.items.map((i) => i.name)).toEqual(['Roses', 'Delivery']);
    check(a);
  });

  it('adds a Tax line on a tax-EXCLUSIVE order (total carries the tax on top)', () => {
    const a = buildNomodAmounts(snap({ taxAmount: '5.00', total: '105.00' }));
    expect(a.amount).toBe('105.00');
    expect(a.items.map((i) => i.name)).toEqual(['Roses', 'Tax']);
    check(a);
  });

  it('adds NO Tax line on a tax-INCLUSIVE order (the tax is already in the prices)', () => {
    const a = buildNomodAmounts(snap({ taxAmount: '4.76', total: '100.00' }));
    expect(a.items.map((i) => i.name)).toEqual(['Roses']);
    expect(a.amount).toBe('100.00');
    check(a);
  });

  it('an order discount goes in the discount field', () => {
    const a = buildNomodAmounts(
      snap({ discountAmount: '10.00', total: '90.00' }),
    );
    expect(a.discount).toBe('10.00');
    expect(a.amount).toBe('90.00');
    check(a);
  });

  it('shipping + exclusive tax + discount together', () => {
    // goods 100 - discount 10 + delivery 15 + tax 5 = 110
    const a = buildNomodAmounts(
      snap({
        deliveryFee: '15.00',
        taxAmount: '5.00',
        discountAmount: '10.00',
        total: '110.00',
      }),
    );
    expect(a.amount).toBe('110.00');
    expect(a.discount).toBe('10.00');
    expect(a.items.map((i) => i.name)).toEqual(['Roses', 'Delivery', 'Tax']);
    check(a);
  });

  it('gift card and store credit are taken off the amount as a discount', () => {
    const a = buildNomodAmounts(
      snap({
        deliveryFee: '15.00',
        total: '115.00',
        giftCardAmount: '20.00',
        storeCreditAmount: '5.00',
      }),
    );
    expect(a.amount).toBe('90.00');
    expect(a.discount).toBe('25.00');
    check(a);
  });

  it('discount + gift card + store credit + tax + delivery, all at once', () => {
    // goods 100 - 10 + 15 + 5 = 110; due = 110 - 20 - 5 = 85
    const a = buildNomodAmounts(
      snap({
        deliveryFee: '15.00',
        taxAmount: '5.00',
        discountAmount: '10.00',
        giftCardAmount: '20.00',
        storeCreditAmount: '5.00',
        total: '110.00',
      }),
    );
    expect(a.amount).toBe('85.00');
    expect(a.amountMinor).toBe(8500);
    expect(a.discount).toBe('35.00');
    check(a);
  });

  it('absorbs a one-minor-unit gap between per-line and whole-order rounding', () => {
    // three lines of 33.335 each round to 33.34 (100.02) while the order total was
    // rounded once from 100.005 to 100.01: the gap becomes a 1 fils discount.
    const a = buildNomodAmounts(
      snap({
        total: '100.01',
        lines: [
          { id: 1, name: 'A', quantity: 1, unitPrice: '33.335' },
          { id: 2, name: 'B', quantity: 1, unitPrice: '33.335' },
          { id: 3, name: 'C', quantity: 1, unitPrice: '33.335' },
        ],
      }),
    );
    expect(a.amount).toBe('100.01');
    expect(a.discount).toBe('0.01');
    check(a);
  });

  it('absorbs a gap in the other direction as an Adjustment line', () => {
    const a = buildNomodAmounts(
      snap({
        total: '100.00',
        lines: [
          { id: 1, name: 'A', quantity: 1, unitPrice: '33.334' },
          { id: 2, name: 'B', quantity: 1, unitPrice: '33.334' },
          { id: 3, name: 'C', quantity: 1, unitPrice: '33.334' },
        ],
      }),
    );
    // lines round to 33.33 x 3 = 99.99; the total is 100.00: +0.01
    expect(a.amount).toBe('100.00');
    expect(a.items.at(-1)?.name).toBe('Adjustment');
    check(a);
  });

  it('a unit price that does not divide the line total is sent as one item', () => {
    // 10.505 x 3 = 31.52, which 3 does not divide into whole fils
    const a = buildNomodAmounts(
      snap({
        total: '31.52',
        lines: [{ id: 1, name: 'Tulips', quantity: 3, unitPrice: '10.505' }],
      }),
    );
    expect(a.items[0]).toMatchObject({
      quantity: 1,
      unit_amount: '31.52',
      total_amount: '31.52',
    });
    expect(a.items[0].name).toBe('Tulips x3');
    check(a);
  });

  it('works for each supported currency', () => {
    for (const currency of ['AED', 'USD', 'EUR', 'GBP', 'SAR']) {
      const a = buildNomodAmounts(snap({ currency }));
      expect(a.currency).toBe(currency);
      expect(a.amount).toBe('100.00');
    }
  });

  it('refuses an unsupported currency', () => {
    for (const currency of ['KWD', 'QAR', 'BHD', 'OMR', 'JPY']) {
      expect(() => buildNomodAmounts(snap({ currency }))).toThrow(
        NomodAmountError,
      );
    }
  });

  it('refuses nothing-to-pay, no lines, and unreadable figures', () => {
    expect(() => buildNomodAmounts(snap({ giftCardAmount: '100.00' }))).toThrow(
      NomodAmountError,
    );
    expect(() => buildNomodAmounts(snap({ lines: [] }))).toThrow(
      NomodAmountError,
    );
    expect(() => buildNomodAmounts(snap({ total: 'abc' }))).toThrow(
      NomodAmountError,
    );
  });

  it('never sends an amount larger than the lines it describes', () => {
    // a total ABOVE the lines + delivery + stated tax is an Adjustment line, so the
    // lines always cover the amount.
    const a = buildNomodAmounts(snap({ total: '120.00' }));
    expect(a.amount).toBe('120.00');
    check(a);
  });

  it('names and clips: long names are cut, empty names fall back', () => {
    const a = buildNomodAmounts(
      snap({
        lines: [
          { id: 1, name: 'x'.repeat(300), quantity: 2, unitPrice: '50.00' },
          { id: 2, name: '   ', quantity: 1, unitPrice: '0.00' },
        ],
      }),
    );
    expect(Array.from(a.items[0].name).length).toBeLessThanOrEqual(100);
    expect(a.items[1].name).toBe('Item');
  });
});

describe('references and currencies', () => {
  it('reference ids are stable, unique per attempt and short', () => {
    expect(nomodReferenceId(42, 1)).toBe('42');
    expect(nomodReferenceId(42, 2)).toBe('42-2');
    expect(nomodReferenceId(42, 3)).toBe('42-3');
    expect(nomodReferenceId(2147483647, 99).length).toBeLessThanOrEqual(100);
  });
  it('currency gate', () => {
    expect(isNomodCurrency('aed')).toBe(true);
    expect(isNomodCurrency('KWD')).toBe(false);
    expect(isNomodCurrency(null)).toBe(false);
  });
});
