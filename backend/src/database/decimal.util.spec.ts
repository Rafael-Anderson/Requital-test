import { trimOrderRow } from './decimal.util';

describe('trimOrderRow', () => {
  it('trims a marketplace line discount like every other line amount, and keeps NULL', () => {
    const out = trimOrderRow({
      deliveryFee: null,
      taxAmount: null,
      discountAmount: null,
      giftCardAmount: null,
      total: '10.000000000000000000000000000000',
      orderitem: [
        {
          priceAtPurchase: '5.000000000000000000000000000000',
          autoDiscountAmount: null,
          unitCost: null,
          marketplaceDiscountAmount: '1.500000000000000000000000000000',
        },
        {
          priceAtPurchase: '5.000000000000000000000000000000',
          autoDiscountAmount: null,
          unitCost: null,
          marketplaceDiscountAmount: null,
        },
      ],
    });
    expect(out.orderitem?.[0].marketplaceDiscountAmount).toBe('1.5');
    expect(out.orderitem?.[1].marketplaceDiscountAmount).toBeNull();
  });
});
