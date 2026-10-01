import {
  computeDiscountAmount,
  computeEligibility,
  lineMatchesScope,
} from './discount-eligibility';

const lines = [
  { productId: 1, collectionIds: [10], amount: 100 },
  { productId: 2, collectionIds: [20], amount: 100 }, // 2 x 50
];
const pct10 = { type: 'PERCENTAGE', value: '10' };

describe('discount eligibility (pure)', () => {
  it('ALL_PRODUCTS covers every line', () => {
    const r = computeEligibility(
      {
        ...pct10,
        appliesTo: 'ALL_PRODUCTS',
        productIds: [],
        collectionIds: [],
      },
      lines,
      'AED',
    );
    expect(r).toMatchObject({
      eligible: true,
      eligibleSubtotal: 200,
      discountAmount: 20,
    });
  });

  it('SPECIFIC_PRODUCTS discounts only the matching line, not the whole cart', () => {
    const r = computeEligibility(
      {
        ...pct10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [1],
        collectionIds: [],
      },
      lines,
      'AED',
    );
    expect(r.eligibleLineIndexes).toEqual([0]);
    expect(r.eligibleSubtotal).toBe(100);
    expect(r.discountAmount).toBe(10);
  });

  it('SPECIFIC_COLLECTIONS matches through the line collection membership', () => {
    const r = computeEligibility(
      {
        type: 'FIXED_AMOUNT',
        value: 150,
        appliesTo: 'SPECIFIC_COLLECTIONS',
        productIds: [],
        collectionIds: [20],
      },
      lines,
      'AED',
    );
    expect(r.eligibleLineIndexes).toEqual([1]);
    expect(r.discountAmount).toBe(100); // capped at the eligible subtotal
  });

  it('a scope that covers no line is not eligible and takes nothing off', () => {
    const r = computeEligibility(
      {
        ...pct10,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [99],
        collectionIds: [],
      },
      lines,
      'AED',
    );
    expect(r).toMatchObject({
      eligible: false,
      eligibleSubtotal: 0,
      discountAmount: 0,
    });
  });

  it('FREE_SHIPPING is eligible on a match but takes no goods amount', () => {
    const r = computeEligibility(
      {
        type: 'FREE_SHIPPING',
        value: null,
        appliesTo: 'SPECIFIC_PRODUCTS',
        productIds: [2],
        collectionIds: [],
      },
      lines,
      'AED',
    );
    expect(r).toMatchObject({ eligible: true, discountAmount: 0 });
  });

  it('rounds once to the currency minor unit (KWD keeps 3 decimals, AED 2)', () => {
    const odd = [{ productId: 1, collectionIds: [], amount: 10.505 * 3 }];
    const d = {
      ...pct10,
      appliesTo: 'ALL_PRODUCTS',
      productIds: [],
      collectionIds: [],
    };
    expect(computeEligibility(d, odd, 'KWD').discountAmount).toBe(3.152); // 3.1515
    expect(computeEligibility(d, odd, 'AED').discountAmount).toBe(3.15);
  });

  it('legacy whole-cart mode takes the amount on the supplied total once a line is eligible', () => {
    const d = {
      ...pct10,
      appliesTo: 'SPECIFIC_PRODUCTS',
      productIds: [1],
      collectionIds: [],
    };
    const legacy = [{ productId: 1, collectionIds: [], amount: 0 }];
    expect(computeEligibility(d, legacy, 'AED', 300).discountAmount).toBe(30);
    expect(computeEligibility(d, [], 'AED', 300).eligible).toBe(false);
    const all = {
      ...pct10,
      appliesTo: 'ALL_PRODUCTS',
      productIds: [],
      collectionIds: [],
    };
    expect(computeEligibility(all, [], 'AED', 300).discountAmount).toBe(30);
  });

  it('lineMatchesScope and computeDiscountAmount are the shared primitives', () => {
    expect(
      lineMatchesScope(
        {
          appliesTo: 'SPECIFIC_COLLECTIONS',
          productIds: [],
          collectionIds: [10],
        },
        { productId: 5, collectionIds: [10, 11] },
      ),
    ).toBe(true);
    expect(computeDiscountAmount({ type: 'PERCENTAGE', value: 150 }, 40)).toBe(
      40,
    );
    expect(
      computeDiscountAmount({ type: 'FREE_SHIPPING', value: null }, 40),
    ).toBe(0);
  });
});
