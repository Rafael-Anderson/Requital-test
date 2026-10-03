import {
  canTransition,
  formatPoNumber,
  isRealDateKey,
  lineAmount,
  PO_STATUSES,
  PO_TRANSITIONS,
  statusAfterReceipt,
  sumAmounts,
} from './purchase-order-rules';

describe('purchase order state machine', () => {
  it('allows exactly the documented transitions', () => {
    const allowed: [string, string][] = [];
    for (const from of PO_STATUSES)
      for (const to of PO_STATUSES)
        if (canTransition(from, to)) allowed.push([from, to]);
    expect(allowed).toEqual([
      ['draft', 'sent'],
      ['draft', 'cancelled'],
      ['sent', 'partially_received'],
      ['sent', 'received'],
      ['sent', 'cancelled'],
      ['partially_received', 'partially_received'],
      ['partially_received', 'received'],
    ]);
  });

  it('cancelling after a partial receipt is impossible (received stock is never reversed)', () => {
    expect(canTransition('partially_received', 'cancelled')).toBe(false);
    expect(canTransition('received', 'cancelled')).toBe(false);
  });

  it('received and cancelled are terminal', () => {
    expect(PO_TRANSITIONS.received).toEqual([]);
    expect(PO_TRANSITIONS.cancelled).toEqual([]);
  });

  it('statusAfterReceipt is received only when every line is in full', () => {
    expect(
      statusAfterReceipt([
        { quantityOrdered: 5, quantityReceived: 5 },
        { quantityOrdered: 2, quantityReceived: 2 },
      ]),
    ).toBe('received');
    expect(
      statusAfterReceipt([
        { quantityOrdered: 5, quantityReceived: 5 },
        { quantityOrdered: 2, quantityReceived: 1 },
      ]),
    ).toBe('partially_received');
  });
});

describe('purchase order money', () => {
  it('rounds a line to 2 decimals for AED and 3 for KWD', () => {
    // 3 x 10.505 = 31.515
    expect(lineAmount(3, 10.505, 'KWD')).toBe(31.515);
    expect(lineAmount(3, 10.505, 'AED')).toBe(31.52);
    expect(lineAmount(7, 0.0125, 'AED')).toBe(0.09);
    expect(lineAmount(7, 0.0125, 'OMR')).toBe(0.088);
  });

  it('keeps a sub-minor-unit rate exact until the line is rounded', () => {
    // 1000 stems at 0.0125 AED is 12.50, not 1000 x round(0.0125) = 10.00.
    expect(lineAmount(1000, 0.0125, 'AED')).toBe(12.5);
  });

  it('sums rounded lines in integer minor units, so the total is the exact sum of the lines', () => {
    const lines = [lineAmount(3, 0.335, 'AED'), lineAmount(3, 0.335, 'AED')];
    expect(lines).toEqual([1.01, 1.01]);
    expect(sumAmounts(lines, 'AED')).toBe(2.02);
    // The total is the sum of the printed lines, not a re-rounded raw sum:
    // three lines of 0.004 each print 0.00, so the document totals 0.00.
    expect(
      sumAmounts([1, 2, 3].map(() => lineAmount(1, 0.004, 'AED')), 'AED'),
    ).toBe(0);
    expect(sumAmounts([0.1, 0.2], 'AED')).toBe(0.3);
    expect(sumAmounts([0.001, 0.002], 'KWD')).toBe(0.003);
  });

  it('formats the number with the PO- prefix', () => {
    expect(formatPoNumber(1)).toBe('PO-0001');
    expect(formatPoNumber(12345)).toBe('PO-12345');
  });
});

describe('isRealDateKey', () => {
  it('accepts real calendar dates only', () => {
    expect(isRealDateKey('2026-10-02')).toBe(true);
    expect(isRealDateKey('2028-02-29')).toBe(true);
    expect(isRealDateKey('2026-02-29')).toBe(false);
    expect(isRealDateKey('2026-13-45')).toBe(false);
  });
});
