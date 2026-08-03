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

describe('computeOrderTotals', () => {
  it('exclusive tax: adds tax on top of subtotal, not delivery fee', () => {
    const { taxAmount, total } = computeOrderTotals({
      subtotal: 100,
      deliveryFee: 10,
      taxRate: 5,
      taxInclusive: false,
    });
    expect(taxAmount).toBeCloseTo(5, 6);
    expect(total).toBeCloseTo(115, 6);
  });

  it('inclusive tax: backs tax out of subtotal, total is subtotal + delivery only', () => {
    const { taxAmount, total } = computeOrderTotals({
      subtotal: 105,
      deliveryFee: 10,
      taxRate: 5,
      taxInclusive: true,
    });
    expect(taxAmount).toBeCloseTo(5, 1);
    expect(total).toBeCloseTo(115, 6);
  });

  it('zero tax rate yields zero tax regardless of inclusive/exclusive', () => {
    expect(
      computeOrderTotals({
        subtotal: 100,
        deliveryFee: 0,
        taxRate: 0,
        taxInclusive: true,
      }).taxAmount,
    ).toBe(0);
    expect(
      computeOrderTotals({
        subtotal: 100,
        deliveryFee: 0,
        taxRate: 0,
        taxInclusive: false,
      }).taxAmount,
    ).toBe(0);
  });
});
