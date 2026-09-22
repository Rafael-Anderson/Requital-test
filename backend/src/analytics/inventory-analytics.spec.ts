import {
  computeMovementMetrics,
  sortByUrgency,
  type ProductMovementInput,
} from './inventory-analytics';

function input(over: Partial<ProductMovementInput> = {}): ProductMovementInput {
  return {
    productId: 1,
    name: 'Rose Bouquet',
    unitsSold: 10,
    stockOnHand: 10,
    daysSinceLastSale: 0,
    ...over,
  };
}

describe('computeMovementMetrics', () => {
  it('returns nothing for no products', () => {
    expect(computeMovementMetrics([], 30, 30)).toEqual([]);
  });

  it('computes sell-through as sold over sold-plus-stock', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 30, stockOnHand: 10 })],
      30,
      30,
    );
    expect(row.sellThroughPercent).toBe(75); // 30 / 40
  });

  it('computes days of cover from the daily average over the window', () => {
    // 30 units in 30 days = 1/day; 45 in stock = 45 days of cover.
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 30, stockOnHand: 45 })],
      30,
      30,
    );
    expect(row.daysOfCover).toBe(45);
  });

  // Cover with no sales is unbounded, not zero. Reporting 0 would put a
  // product nobody is buying at the top of a "running out" list.
  it('is days of cover null, not zero, when nothing sold', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 0, stockOnHand: 50, daysSinceLastSale: null })],
      30,
      30,
    );
    expect(row.daysOfCover).toBeNull();
    expect(row.sellThroughPercent).toBe(0);
  });

  // A recipe-backed product has no shadow ingredient row, so it has no stock
  // figure at all - which is not the same as having none in stock.
  it('leaves both ratios null when there is no stock figure', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 5, stockOnHand: null })],
      30,
      30,
    );
    expect(row.sellThroughPercent).toBeNull();
    expect(row.daysOfCover).toBeNull();
    expect(row.isDeadStock).toBe(false); // cannot be dead capital we cannot see
  });

  it('is 0% sell-through, not a divide by zero, when nothing sold and nothing held', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 0, stockOnHand: 0, daysSinceLastSale: null })],
      30,
      30,
    );
    expect(row.sellThroughPercent).toBe(0);
    expect(row.daysOfCover).toBeNull();
  });

  describe('dead stock', () => {
    it('flags stock that has not moved for longer than the threshold', () => {
      const [row] = computeMovementMetrics(
        [input({ unitsSold: 0, stockOnHand: 12, daysSinceLastSale: 45 })],
        30,
        30,
      );
      expect(row.isDeadStock).toBe(true);
    });

    it('flags stock that has never moved at all', () => {
      const [row] = computeMovementMetrics(
        [input({ unitsSold: 0, stockOnHand: 12, daysSinceLastSale: null })],
        30,
        30,
      );
      expect(row.isDeadStock).toBe(true);
    });

    it('does not flag something still selling', () => {
      const [row] = computeMovementMetrics(
        [input({ unitsSold: 3, stockOnHand: 12, daysSinceLastSale: 2 })],
        30,
        30,
      );
      expect(row.isDeadStock).toBe(false);
    });

    // Nothing on hand is discontinued, not dead capital. Listing it would bury
    // the rows a merchant can actually act on.
    it('does not flag a stale product with nothing on hand', () => {
      const [row] = computeMovementMetrics(
        [input({ unitsSold: 0, stockOnHand: 0, daysSinceLastSale: 99 })],
        30,
        30,
      );
      expect(row.isDeadStock).toBe(false);
    });

    it('respects a custom threshold', () => {
      const rows = computeMovementMetrics(
        [input({ unitsSold: 0, stockOnHand: 5, daysSinceLastSale: 10 })],
        30,
        7,
      );
      expect(rows[0].isDeadStock).toBe(true);
      expect(
        computeMovementMetrics(
          [input({ unitsSold: 0, stockOnHand: 5, daysSinceLastSale: 10 })],
          30,
          14,
        )[0].isDeadStock,
      ).toBe(false);
    });
  });

  it('never divides by a zero window', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: 10, stockOnHand: 10 })],
      0,
      30,
    );
    expect(Number.isFinite(row.daysOfCover as number)).toBe(true);
  });

  it('treats a negative units figure as zero rather than inverting the ratios', () => {
    const [row] = computeMovementMetrics(
      [input({ unitsSold: -5, stockOnHand: 10 })],
      30,
      30,
    );
    expect(row.unitsSold).toBe(0);
    expect(row.sellThroughPercent).toBe(0);
  });
});

describe('sortByUrgency', () => {
  it('puts the lowest days of cover first', () => {
    const rows = computeMovementMetrics(
      [
        input({ productId: 1, unitsSold: 30, stockOnHand: 90 }), // 90 days
        input({ productId: 2, unitsSold: 30, stockOnHand: 3 }), // 3 days
        input({ productId: 3, unitsSold: 30, stockOnHand: 30 }), // 30 days
      ],
      30,
      30,
    );
    expect(sortByUrgency(rows).map((r) => r.productId)).toEqual([2, 3, 1]);
  });

  // "Unknown" is not "urgent" - sorting nulls first would bury real stockouts.
  it('sorts rows with no cover figure last, by units sold', () => {
    const rows = computeMovementMetrics(
      [
        input({ productId: 1, unitsSold: 0, stockOnHand: 5, daysSinceLastSale: null }),
        input({ productId: 2, unitsSold: 30, stockOnHand: 3 }),
        input({ productId: 3, unitsSold: 7, stockOnHand: null }),
      ],
      30,
      30,
    );
    const order = sortByUrgency(rows).map((r) => r.productId);
    expect(order[0]).toBe(2);
    expect(order.slice(1).sort()).toEqual([1, 3]);
  });

  it('does not mutate its input', () => {
    const rows = computeMovementMetrics(
      [
        input({ productId: 1, unitsSold: 30, stockOnHand: 90 }),
        input({ productId: 2, unitsSold: 30, stockOnHand: 3 }),
      ],
      30,
      30,
    );
    const before = rows.map((r) => r.productId);
    sortByUrgency(rows);
    expect(rows.map((r) => r.productId)).toEqual(before);
  });
});
