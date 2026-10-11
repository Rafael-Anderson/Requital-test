import {
  applyMinOrderQty,
  baseOrderQuantity,
  groupByPurchaseOrder,
  pickSupplier,
  positionOf,
} from './reorder-rules';

const c = (over: Partial<Parameters<typeof baseOrderQuantity>[0]> = {}) => ({
  stock: 3,
  onOrder: 0,
  reorderPoint: 10,
  reorderQuantity: 20,
  ...over,
});

describe('baseOrderQuantity', () => {
  it('unknown stays unknown: no point means no suggestion, a point of 0 is a real point', () => {
    expect(baseOrderQuantity(c({ reorderPoint: null }))).toEqual({ skip: 'no_reorder_point' });
    expect(baseOrderQuantity(c({ reorderPoint: 0, stock: 0 }))).toEqual({ quantity: 20 });
    expect(baseOrderQuantity(c({ reorderPoint: 0, stock: 1 }))).toEqual({ skip: 'covered' });
  });

  it('a missing reorder quantity is listed, never defaulted', () => {
    expect(baseOrderQuantity(c({ reorderQuantity: null }))).toEqual({ skip: 'no_reorder_quantity' });
  });

  it('nets quantity already on open orders: position, not stock, is compared to the point', () => {
    expect(baseOrderQuantity(c({ stock: 3, onOrder: 20 }))).toEqual({ skip: 'covered' });
    // 3 + 5 = 8 <= 10 still needs ordering: shortfall 3 -> one multiple of 20
    expect(baseOrderQuantity(c({ stock: 3, onOrder: 5 }))).toEqual({ quantity: 20 });
    expect(positionOf({ stock: 3, onOrder: -4 })).toBe(3);
  });

  it('orders whole multiples of the reorder quantity until back above the point', () => {
    // point 10, stock 0, Q 4: need 11 -> 3 x 4 = 12
    expect(baseOrderQuantity(c({ stock: 0, reorderQuantity: 4 }))).toEqual({ quantity: 12 });
    // negative stock (admin confirm allows it): need 10 + 1 + 5 = 16 -> 4 x 4
    expect(baseOrderQuantity(c({ stock: -5, reorderQuantity: 4 }))).toEqual({ quantity: 16 });
    // exactly at the point: need 1 -> one multiple
    expect(baseOrderQuantity(c({ stock: 10, reorderQuantity: 4 }))).toEqual({ quantity: 4 });
  });
});

describe('applyMinOrderQty', () => {
  it('raises to the supplier minimum, never lowers, never exceeds the line cap', () => {
    expect(applyMinOrderQty(12, 50)).toBe(50);
    expect(applyMinOrderQty(60, 50)).toBe(60);
    expect(applyMinOrderQty(12, null)).toBe(12);
    expect(applyMinOrderQty(5_000_000, null)).toBe(1_000_000);
  });
});

describe('pickSupplier', () => {
  const o = (supplierId: number, unitCost: number, currency = 'AED', leadTimeDays: number | null = null) => ({
    supplierId, unitCost, currency, minOrderQty: null, leadTimeDays,
  });
  it('none -> null', () => expect(pickSupplier([])).toBeNull());
  it('one currency: cheapest wins, ties by lead time then id', () => {
    expect(pickSupplier([o(1, 5), o(2, 3), o(3, 4)])?.chosen.supplierId).toBe(2);
    expect(pickSupplier([o(1, 3, 'AED', 9), o(2, 3, 'AED', 2)])?.chosen.supplierId).toBe(2);
    expect(pickSupplier([o(4, 3), o(2, 3)])?.chosen.supplierId).toBe(2);
    expect(pickSupplier([o(1, 5), o(2, 3)])).toMatchObject({ priceComparable: true, alternatives: 1 });
  });
  it('mixed currencies are never price-compared (a 0.5 KWD is not "cheaper" than 3 AED)', () => {
    const r = pickSupplier([o(1, 0.5, 'KWD', 7), o(2, 3, 'AED', 2)]);
    expect(r?.chosen.supplierId).toBe(2);
    expect(r?.priceComparable).toBe(false);
  });
});

describe('groupByPurchaseOrder', () => {
  const e = (outletId: number, supplierId: number, ingredientId: number, quantity: number, unitCost: number, currency: string) => ({
    outletId, supplierId, ingredientId, quantity, unitCost, currency, lineTotal: 0,
  });
  it('splits one supplier priced in two currencies, and one outlet from another', () => {
    const g = groupByPurchaseOrder([
      e(1, 7, 10, 2, 1, 'AED'),
      e(1, 7, 11, 2, 1, 'KWD'),
      e(2, 7, 10, 2, 1, 'AED'),
      e(1, 7, 12, 1, 2, 'AED'),
    ]);
    expect(g.map((x) => `${x.outletId}/${x.supplierId}/${x.currency}/${x.lines.length}`)).toEqual([
      '1/7/AED/2', '1/7/KWD/1', '2/7/AED/1',
    ]);
  });
  it('rounds each line once by the currency minor unit and sums in minor units (KWD 3dp)', () => {
    const [g] = groupByPurchaseOrder([e(1, 1, 1, 3, 10.505, 'KWD'), e(1, 1, 2, 1, 0.0004, 'KWD')]);
    expect(g.subtotal).toBe(31.515);
    const [a] = groupByPurchaseOrder([e(1, 1, 1, 3, 10.505, 'AED')]);
    expect(a.subtotal).toBe(31.52);
  });
});
