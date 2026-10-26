import {
  checkoutFingerprint,
  PaymentUnavailableException,
  providerTimeoutMs,
} from './checkout-recovery';

const base = {
  outletId: 1,
  paymentMethod: 'card_online',
  items: [{ productId: 3, quantity: 2 }],
  customerPhone: '0501234567',
};

describe('checkoutFingerprint', () => {
  it('ignores key order, the key itself, attribution and undefined/null fields', () => {
    const a = checkoutFingerprint(base, null);
    expect(
      checkoutFingerprint(
        {
          customerPhone: '0501234567',
          items: [{ quantity: 2, productId: 3 }],
          paymentMethod: 'card_online',
          outletId: 1,
          idempotencyKey: 'abcdefghijklmnop',
          attribution: { utm: 'x' },
          area: undefined,
          deliveryNotes: null,
        },
        null,
      ),
    ).toBe(a);
  });

  it('changes with anything that is part of the order', () => {
    const a = checkoutFingerprint(base, null);
    expect(
      checkoutFingerprint(
        { ...base, items: [{ productId: 3, quantity: 3 }] },
        null,
      ),
    ).not.toBe(a);
    expect(checkoutFingerprint({ ...base, discountCode: 'X' }, null)).not.toBe(
      a,
    );
    expect(checkoutFingerprint(base, 7)).not.toBe(a);
    // item order is part of the request
    expect(
      checkoutFingerprint(
        {
          ...base,
          items: [
            { productId: 4, quantity: 1 },
            { productId: 3, quantity: 2 },
          ],
        },
        null,
      ),
    ).not.toBe(
      checkoutFingerprint(
        {
          ...base,
          items: [
            { productId: 3, quantity: 2 },
            { productId: 4, quantity: 1 },
          ],
        },
        null,
      ),
    );
  });
});

describe('PaymentUnavailableException', () => {
  it('is a 503 with a stable code and a message that names no gateway or id and has no em dash', () => {
    const e = new PaymentUnavailableException();
    expect(e.getStatus()).toBe(503);
    const body = e.getResponse() as { code: string; message: string };
    expect(body.code).toBe('payment_unavailable');
    expect(body.message).not.toMatch(/stripe|tabby|tamara|paypal|nomod|—|#\d/i);
  });
});

describe('providerTimeoutMs', () => {
  it('honours the override only under NODE_ENV=test, within its bounds', () => {
    expect(
      providerTimeoutMs({
        NODE_ENV: 'test',
        PAYMENT_PROVIDER_TIMEOUT_MS: '300',
      }),
    ).toBe(300);
    expect(
      providerTimeoutMs({ NODE_ENV: 'test', PAYMENT_PROVIDER_TIMEOUT_MS: '5' }),
    ).toBe(30_000);
    expect(
      providerTimeoutMs({
        NODE_ENV: 'test',
        PAYMENT_PROVIDER_TIMEOUT_MS: '999999',
      }),
    ).toBe(30_000);
    expect(providerTimeoutMs({ NODE_ENV: 'test' })).toBe(30_000);
  });

  it('ignores the override in production and in an unset environment', () => {
    expect(
      providerTimeoutMs({
        NODE_ENV: 'production',
        PAYMENT_PROVIDER_TIMEOUT_MS: '300',
      }),
    ).toBe(30_000);
    expect(providerTimeoutMs({ PAYMENT_PROVIDER_TIMEOUT_MS: '300' })).toBe(
      30_000,
    );
  });
});
