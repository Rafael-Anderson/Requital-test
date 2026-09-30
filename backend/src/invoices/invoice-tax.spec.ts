import { buildTaxBreakdown } from './invoice-tax';

function line(
  price: number,
  qty: number,
  rate: number | null,
  tax: number | null,
) {
  return {
    priceAtPurchase: String(price),
    quantity: qty,
    taxRate: rate === null ? null : String(rate.toFixed(2)),
    taxAmount: tax === null ? null : String(tax),
  };
}

describe('buildTaxBreakdown', () => {
  // An order placed before B2's capture has nothing to group. A breakdown
  // reconstructed from today's rates would be a claim about a historical sale
  // that nobody recorded, so the document shows the single Tax total instead.
  it('returns nothing when no line carries the capture', () => {
    expect(
      buildTaxBreakdown({
        items: [line(100, 1, null, null), line(50, 2, null, null)],
        discountAmount: null,
        taxInclusive: false,
        orderTaxAmount: '7.50',
      }),
    ).toEqual([]);
  });

  it('groups exclusive lines by rate, standard first', () => {
    const rows = buildTaxBreakdown({
      items: [line(100, 1, 5, 5), line(200, 1, 5, 10), line(50, 1, 0, 0)],
      discountAmount: null,
      taxInclusive: false,
      orderTaxAmount: '15',
    });
    expect(rows).toEqual([
      { taxRate: 5, taxableAmount: 300, taxAmount: 15 },
      { taxRate: 0, taxableAmount: 50, taxAmount: 0 },
    ]);
  });

  // Zero-rated and exempt lines are listed WITH their net. On a VAT return "what
  // was zero-rated" is exactly as reportable as what was taxed.
  it('lists a zero-rated line with its net rather than dropping it', () => {
    const rows = buildTaxBreakdown({
      items: [line(100, 1, 0, 0)],
      discountAmount: null,
      taxInclusive: false,
      orderTaxAmount: '0',
    });
    expect(rows).toEqual([{ taxRate: 0, taxableAmount: 100, taxAmount: 0 }]);
  });

  // The net shown is the base the tax was actually charged on, so the order-level
  // discount has to be apportioned the same way computeOrderTotals apportioned it.
  it('apportions the order discount pro rata into the net', () => {
    const rows = buildTaxBreakdown({
      items: [line(100, 1, 5, 3.75), line(300, 1, 5, 11.25)],
      discountAmount: '100',
      taxInclusive: false,
      orderTaxAmount: '15',
    });
    // 25 off the first line, 75 off the second: 75 + 225 = 300 net at 5%.
    expect(rows).toEqual([{ taxRate: 5, taxableAmount: 300, taxAmount: 15 }]);
  });

  // Inclusive pricing: the charged amount contains the tax, so the taxable base
  // is what remains once it is taken out. Printing the gross as "net" would
  // overstate the reportable base.
  it('takes the tax out of the net on an inclusive shop', () => {
    const rows = buildTaxBreakdown({
      items: [line(105, 1, 5, 5)],
      discountAmount: null,
      taxInclusive: true,
      orderTaxAmount: '5',
    });
    expect(rows).toEqual([{ taxRate: 5, taxableAmount: 100, taxAmount: 5 }]);
  });

  // Tax the lines do not account for can only be a taxed delivery fee. Shown as
  // its own row so the table still sums to the document's Tax total - a summary
  // that does not add up is the defect B2 fixed one layer up.
  it('adds a delivery row for tax the lines do not account for', () => {
    const rows = buildTaxBreakdown({
      items: [line(100, 1, 5, 5)],
      discountAmount: null,
      taxInclusive: false,
      orderTaxAmount: '6',
    });
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual({
      taxRate: 0,
      taxableAmount: 0,
      taxAmount: 1,
      label: 'Delivery',
    });
    expect(rows.reduce((s, r) => s + r.taxAmount, 0)).toBeCloseTo(6, 6);
  });

  it('ignores sub-fils float noise rather than inventing a delivery row', () => {
    const rows = buildTaxBreakdown({
      items: [line(33.33, 1, 5, 1.67)],
      discountAmount: null,
      taxInclusive: false,
      // 0.003 more than the line: rounding noise, not a delivery charge.
      orderTaxAmount: '1.673',
    });
    expect(rows).toHaveLength(1);
  });

  it('never divides by a zero-value basket', () => {
    const rows = buildTaxBreakdown({
      items: [line(0, 1, 5, 0)],
      discountAmount: '10',
      taxInclusive: false,
      orderTaxAmount: '0',
    });
    expect(rows[0].taxableAmount).toBe(0);
    expect(Number.isNaN(rows[0].taxableAmount)).toBe(false);
  });

  it('a discount larger than the basket cannot make the net negative', () => {
    const rows = buildTaxBreakdown({
      items: [line(100, 1, 5, 0)],
      discountAmount: '500',
      taxInclusive: false,
      orderTaxAmount: '0',
    });
    expect(rows[0].taxableAmount).toBe(0);
  });
});
