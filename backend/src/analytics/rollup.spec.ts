import {
  computeProductDayMetrics,
  computeShopDayMetrics,
  type RollupItemRow,
  type RollupOrderRow,
} from './rollup';

function order(over: Partial<RollupOrderRow> & { id: number }): RollupOrderRow {
  return {
    outletId: 1,
    customerId: null,
    deliveryFee: null,
    taxAmount: null,
    discountAmount: null,
    ...over,
  };
}

function item(over: Partial<RollupItemRow> & { orderId: number }): RollupItemRow {
  return {
    productId: 10,
    quantity: 1,
    priceAtPurchase: '20.00',
    unitCost: '8.00',
    ...over,
  };
}

describe('computeShopDayMetrics', () => {
  it('a day with no orders produces no rows at all', () => {
    expect(computeShopDayMetrics([], [], new Set())).toEqual([]);
  });

  it('sums merchandise revenue and cogs for a normal day', () => {
    const rows = computeShopDayMetrics(
      [
        order({ id: 1, deliveryFee: '15.00', taxAmount: '2.00' }),
        order({ id: 2, discountAmount: '5.00' }),
      ],
      [
        item({ orderId: 1, quantity: 2 }), // 2 x 20 = 40 revenue, 2 x 8 = 16 cost
        item({ orderId: 2, quantity: 1 }), // 20 revenue, 8 cost
      ],
      new Set(),
    );

    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      outletId: 1,
      orders: 2,
      revenue: '60.00',
      cogs: '24.00',
      discount: '5.00',
      delivery: '15.00',
      tax: '2.00',
      newCustomers: 0,
      returningCustomers: 0,
      linesWithoutCost: 0,
    });
  });

  // The case the null-not-zero rule exists for.
  it('excludes uncosted lines from cogs and counts them instead', () => {
    const rows = computeShopDayMetrics(
      [order({ id: 1 })],
      [
        item({ orderId: 1, quantity: 1, unitCost: '8.00' }),
        item({ orderId: 1, quantity: 3, unitCost: null }),
      ],
      new Set(),
    );

    // Revenue counts every line that sold; cogs counts only what we know.
    expect(rows[0].revenue).toBe('80.00');
    expect(rows[0].cogs).toBe('8.00');
    expect(rows[0].linesWithoutCost).toBe(1);
  });

  it('is cogs null, not zero, when no line on the day carried a cost', () => {
    const rows = computeShopDayMetrics(
      [order({ id: 1 })],
      [item({ orderId: 1, unitCost: null })],
      new Set(),
    );
    expect(rows[0].cogs).toBeNull();
    expect(rows[0].revenue).toBe('20.00');
    expect(rows[0].linesWithoutCost).toBe(1);
  });

  it('treats an unparseable cost as absent rather than as zero', () => {
    const rows = computeShopDayMetrics(
      [order({ id: 1 })],
      [item({ orderId: 1, unitCost: 'not-a-number' })],
      new Set(),
    );
    expect(rows[0].cogs).toBeNull();
    expect(rows[0].linesWithoutCost).toBe(1);
  });

  it('splits rows per outlet rather than merging branches', () => {
    const rows = computeShopDayMetrics(
      [order({ id: 1, outletId: 7 }), order({ id: 2, outletId: 3 })],
      [item({ orderId: 1 }), item({ orderId: 2, quantity: 2 })],
      new Set(),
    );
    expect(rows.map((r) => r.outletId)).toEqual([3, 7]); // sorted
    expect(rows.find((r) => r.outletId === 3)?.revenue).toBe('40.00');
    expect(rows.find((r) => r.outletId === 7)?.revenue).toBe('20.00');
  });

  describe('new vs returning customers', () => {
    it('counts a first-ever-order customer as new and the rest as returning', () => {
      const rows = computeShopDayMetrics(
        [
          order({ id: 1, customerId: 100 }),
          order({ id: 2, customerId: 200 }),
        ],
        [item({ orderId: 1 }), item({ orderId: 2 })],
        new Set([100]),
      );
      expect(rows[0].newCustomers).toBe(1);
      expect(rows[0].returningCustomers).toBe(1);
    });

    it('counts a customer once however many orders they placed that day', () => {
      const rows = computeShopDayMetrics(
        [
          order({ id: 1, customerId: 100 }),
          order({ id: 2, customerId: 100 }),
          order({ id: 3, customerId: 100 }),
        ],
        [item({ orderId: 1 }), item({ orderId: 2 }), item({ orderId: 3 })],
        new Set([100]),
      );
      expect(rows[0].orders).toBe(3);
      expect(rows[0].newCustomers).toBe(1);
      expect(rows[0].returningCustomers).toBe(0);
    });

    // A guest checkout has no identity to classify; counting it either way
    // would invent a customer or inflate the returning figure.
    it('counts a guest order as neither new nor returning', () => {
      const rows = computeShopDayMetrics(
        [order({ id: 1, customerId: null })],
        [item({ orderId: 1 })],
        new Set(),
      );
      expect(rows[0].orders).toBe(1);
      expect(rows[0].newCustomers).toBe(0);
      expect(rows[0].returningCustomers).toBe(0);
    });
  });

  it('counts an order with no line items without inventing revenue', () => {
    const rows = computeShopDayMetrics([order({ id: 1 })], [], new Set());
    expect(rows[0].orders).toBe(1);
    expect(rows[0].revenue).toBe('0.00');
    expect(rows[0].cogs).toBeNull();
  });
});

describe('computeProductDayMetrics', () => {
  it('a day with no orders produces no rows', () => {
    expect(computeProductDayMetrics([], [])).toEqual([]);
  });

  it('groups units, revenue and cogs by product and outlet', () => {
    const rows = computeProductDayMetrics(
      [order({ id: 1, outletId: 1 }), order({ id: 2, outletId: 2 })],
      [
        item({ orderId: 1, productId: 10, quantity: 2 }),
        item({ orderId: 1, productId: 11, quantity: 1, priceAtPurchase: '5.00', unitCost: '1.00' }),
        item({ orderId: 2, productId: 10, quantity: 3 }),
      ],
    );

    expect(rows).toEqual([
      { productId: 10, outletId: 1, units: 2, revenue: '40.00', cogs: '16.00', linesWithoutCost: 0 },
      { productId: 10, outletId: 2, units: 3, revenue: '60.00', cogs: '24.00', linesWithoutCost: 0 },
      { productId: 11, outletId: 1, units: 1, revenue: '5.00', cogs: '1.00', linesWithoutCost: 0 },
    ]);
  });

  it('applies the same null-not-zero cost rule per product', () => {
    const rows = computeProductDayMetrics(
      [order({ id: 1 })],
      [
        item({ orderId: 1, productId: 10, unitCost: null }),
        item({ orderId: 1, productId: 11, unitCost: '2.00' }),
      ],
    );
    expect(rows.find((r) => r.productId === 10)?.cogs).toBeNull();
    expect(rows.find((r) => r.productId === 10)?.linesWithoutCost).toBe(1);
    expect(rows.find((r) => r.productId === 11)?.cogs).toBe('2.00');
  });

  // Guards against attributing a line to an arbitrary outlet, which would
  // silently corrupt a branch's numbers rather than just omitting one line.
  it('skips an item whose order is not in the day being rolled up', () => {
    const rows = computeProductDayMetrics(
      [order({ id: 1 })],
      [item({ orderId: 1 }), item({ orderId: 999 })],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].units).toBe(1);
  });
});
