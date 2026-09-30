import { computeOrderTotals, matchDeliveryZone } from './order-pricing';

describe('matchDeliveryZone', () => {
  const zones = [
    { name: 'Downtown', isActive: true },
    { name: 'Dubai', isActive: true },
    { name: 'Sharjah', isActive: false },
  ];

  it('matches by area first, case-insensitively', () => {
    expect(matchDeliveryZone(zones, 'downtown', 'Dubai')?.name).toBe(
      'Downtown',
    );
  });

  it('falls back to emirate when area does not match any zone', () => {
    expect(matchDeliveryZone(zones, 'Some Random Area', 'Dubai')?.name).toBe(
      'Dubai',
    );
  });

  it('falls back to emirate when area is omitted', () => {
    expect(matchDeliveryZone(zones, undefined, 'Dubai')?.name).toBe('Dubai');
  });

  it('returns null when neither area nor emirate match any active zone', () => {
    expect(matchDeliveryZone(zones, 'Nowhere', 'Fujairah')).toBeNull();
  });

  it('never matches an inactive zone, even by exact name', () => {
    expect(matchDeliveryZone(zones, 'Sharjah', 'Sharjah')).toBeNull();
  });
});

// One helper so each case reads as "these lines, this shop setting" rather than
// a wall of object literals. `rate` is a percentage; taxClassId is carried
// through untouched and only asserted where it matters.
function line(amount: number, rate: number, taxClassId: number | null = 1) {
  return { amount, taxRate: rate, taxClassId };
}

describe('computeOrderTotals', () => {
  // The two cases that existed before per-line tax, restated against the new
  // signature. A single-rate basket must behave exactly as it always did - that
  // is what makes this change safe for every shop that has one rate.
  it('exclusive tax: adds tax on top of the lines, not the delivery fee', () => {
    const { taxAmount, total } = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 10,
      taxInclusive: false,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it('inclusive tax: backs the tax out, total is lines + delivery only', () => {
    const { taxAmount, total } = computeOrderTotals({
      lines: [line(105, 5)],
      deliveryFee: 10,
      taxInclusive: true,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it.each([true, false])(
    'a zero rate yields zero tax with taxInclusive=%s',
    (taxInclusive) => {
      expect(
        computeOrderTotals({
          lines: [line(100, 0)],
          deliveryFee: 0,
          taxInclusive,
        }).taxAmount,
      ).toBe(0);
    },
  );

  // THE case this whole phase exists for. Before per-line tax, one shop rate hit
  // the entire subtotal, so a zero-rated or exempt product was charged VAT it
  // does not owe and the merchant filed a wrong return.
  it('taxes each line at its own rate, mixing standard, zero and exempt', () => {
    const result = computeOrderTotals({
      lines: [
        line(100, 5, 1), // standard
        line(50, 0, 2), // zero rated
        line(30, 0, 3), // exempt - same 0%, different class
      ],
      deliveryFee: 0,
      taxInclusive: false,
    });
    // 5% of the standard line only, NOT of 180.
    expect(result.taxAmount).toBeCloseTo(5, 6);
    expect(result.total).toBeCloseTo(185, 6);
    expect(result.lines.map((l) => l.taxAmount)).toEqual([5, 0, 0]);
    // The per-line capture carries the class through, so the orderitem row can
    // record which class was applied, not just the rate.
    expect(result.lines.map((l) => l.taxClassId)).toEqual([1, 2, 3]);
  });

  it('groups the breakdown by rate, standard first, for a VAT document', () => {
    const { breakdown } = computeOrderTotals({
      lines: [line(100, 5), line(200, 5), line(50, 0, 2)],
      deliveryFee: 0,
      taxInclusive: false,
    });
    expect(breakdown).toEqual([
      { taxRate: 5, taxableAmount: 300, taxAmount: 15 },
      { taxRate: 0, taxableAmount: 50, taxAmount: 0 },
    ]);
  });

  // An order-level discount has no single base to reduce once rates differ, so
  // it is apportioned pro rata. Tax is owed on what the customer actually pays.
  it('apportions an order-level discount across lines pro rata', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5), line(300, 5)],
      deliveryFee: 0,
      discountAmount: 40,
      taxInclusive: false,
    });
    // 10 off the first line, 30 off the second.
    expect(result.lines[0].taxableAmount).toBeCloseTo(90, 6);
    expect(result.lines[1].taxableAmount).toBeCloseTo(270, 6);
    expect(result.taxAmount).toBeCloseTo(18, 6); // 5% of 360, not of 400
    expect(result.total).toBeCloseTo(378, 6);
  });

  it('apportioning a discount only reduces the taxed line when the other is zero rated', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5), line(100, 0, 2)],
      deliveryFee: 0,
      discountAmount: 50,
      taxInclusive: false,
    });
    // Half the discount lands on each line; only the standard line owes tax.
    expect(result.lines[0].taxableAmount).toBeCloseTo(75, 6);
    expect(result.taxAmount).toBeCloseTo(3.75, 6);
  });

  it('never lets a discount larger than the basket produce negative tax', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 10,
      discountAmount: 500,
      taxInclusive: false,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBeCloseTo(10, 6);
  });

  it('handles a zero-value basket without dividing by zero', () => {
    const result = computeOrderTotals({
      lines: [line(0, 5)],
      deliveryFee: 0,
      discountAmount: 10,
      taxInclusive: false,
    });
    expect(result.taxAmount).toBe(0);
    expect(result.total).toBe(0);
    expect(Number.isNaN(result.lines[0].taxableAmount)).toBe(false);
  });

  // shop.taxOnDelivery, off by default: the behaviour this function has always
  // had is that delivery is untaxed.
  it('leaves the delivery fee untaxed by default', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 20,
      taxInclusive: false,
    });
    expect(result.deliveryTaxAmount).toBe(0);
    expect(result.taxAmount).toBeCloseTo(5, 6);
    expect(result.total).toBeCloseTo(125, 6);
  });

  it('taxes the delivery fee when the shop opts in, at the shop rate', () => {
    const result = computeOrderTotals({
      lines: [line(100, 5)],
      deliveryFee: 20,
      taxInclusive: false,
      taxOnDelivery: true,
      deliveryTaxRate: 5,
    });
    expect(result.deliveryTaxAmount).toBeCloseTo(1, 6);
    expect(result.taxAmount).toBeCloseTo(6, 6);
    expect(result.total).toBeCloseTo(126, 6);
    // It joins the 5% group rather than appearing as its own rate.
    expect(result.breakdown).toEqual([
      { taxRate: 5, taxableAmount: 120, taxAmount: 6 },
    ]);
  });

  it('taxes delivery inclusively on an inclusive shop, without inflating the total', () => {
    const result = computeOrderTotals({
      lines: [line(105, 5)],
      deliveryFee: 21,
      taxInclusive: true,
      taxOnDelivery: true,
      deliveryTaxRate: 5,
    });
    expect(result.deliveryTaxAmount).toBeCloseTo(1, 6);
    expect(result.taxAmount).toBeCloseTo(6, 6);
    // Inclusive means the fee already contains its tax: the customer pays 126.
    expect(result.total).toBeCloseTo(126, 6);
  });

  it('ignores taxOnDelivery when there is no fee or no rate', () => {
    for (const params of [
      { deliveryFee: 0, deliveryTaxRate: 5 },
      { deliveryFee: 20, deliveryTaxRate: 0 },
    ]) {
      expect(
        computeOrderTotals({
          lines: [line(100, 0, 2)],
          taxInclusive: false,
          taxOnDelivery: true,
          ...params,
        }).deliveryTaxAmount,
      ).toBe(0);
    }
  });

  // The rounding policy: this function computes at FULL precision and rounds
  // nothing. Callers round once per stored column at persist (roundMoney with
  // the order's own currency). Pinned here because a function that pre-rounded
  // would make the per-line captures and the order total disagree.
  it('returns unrounded values, leaving rounding to the persist boundary', () => {
    const result = computeOrderTotals({
      lines: [line(33.33, 5), line(33.33, 5), line(33.34, 5)],
      deliveryFee: 0,
      taxInclusive: false,
    });
    // 5% of 33.33 is 1.6665 - not a representable fils amount, and deliberately
    // returned as-is.
    expect(result.lines[0].taxAmount).toBeCloseTo(1.6665, 10);
    expect(result.taxAmount).toBeCloseTo(5, 10);
    // And the parts still reconcile to the whole at full precision.
    const sum = result.lines.reduce((s, l) => s + l.taxAmount, 0);
    expect(sum).toBeCloseTo(result.taxAmount, 10);
  });

  it('keeps the inclusive back-out exact for a 3-decimal currency amount', () => {
    const result = computeOrderTotals({
      lines: [line(10.5, 5)],
      deliveryFee: 0,
      taxInclusive: true,
    });
    expect(result.lines[0].taxableAmount).toBeCloseTo(10, 6);
    expect(result.taxAmount).toBeCloseTo(0.5, 6);
    expect(result.total).toBeCloseTo(10.5, 6);
  });
});
