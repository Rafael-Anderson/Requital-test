import { createHmac } from 'crypto';
import { TabbyPaymentProvider } from './tabby-payment.provider';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';

function sign(payload: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('TabbyPaymentProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TABBY_SECRET_KEY;
    delete process.env.TABBY_PUBLIC_KEY;
    delete process.env.TABBY_WEBHOOK_SECRET;
  });

  describe('createCheckoutSession', () => {
    it('returns the installments web_url as the checkout URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pay_123',
          status: 'created',
          configuration: {
            available_products: {
              installments: [{ web_url: 'https://checkout.tabby.ai/pay_123' }],
            },
          },
        }),
      });

      const provider = new TabbyPaymentProvider();
      const session = await provider.createCheckoutSession({
        orderId: 42,
        amount: 100,
        currency: 'AED',
        successUrl: 'https://shop.example/success',
        cancelUrl: 'https://shop.example/cancel',
        credentials: { publicKey: 'pk_test', secretKey: 'sk_test' },
      });

      expect(session).toEqual({
        providerReference: 'pay_123',
        checkoutUrl: 'https://checkout.tabby.ai/pay_123',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.stringContaining('/checkout'),
        expect.objectContaining({
          headers: expect.objectContaining({ Authorization: 'Bearer sk_test' }),
        }),
      );
    });

    it('throws PaymentProviderNotConfiguredException when neither per-shop nor platform credentials are set', async () => {
      const provider = new TabbyPaymentProvider();
      await expect(
        provider.createCheckoutSession({
          orderId: 1,
          amount: 10,
          currency: 'AED',
          successUrl: 'https://x',
          cancelUrl: 'https://x',
          credentials: null,
        }),
      ).rejects.toThrow(PaymentProviderNotConfiguredException);
    });

    it('falls back to the platform-level env vars when a shop has no credentials of its own', async () => {
      process.env.TABBY_SECRET_KEY = 'platform-secret';
      process.env.TABBY_PUBLIC_KEY = 'platform-public';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          id: 'pay_1',
          configuration: {
            available_products: { installments: [{ web_url: 'https://x' }] },
          },
        }),
      });

      const provider = new TabbyPaymentProvider();
      await provider.createCheckoutSession({
        orderId: 1,
        amount: 10,
        currency: 'AED',
        successUrl: 'https://x',
        cancelUrl: 'https://x',
        credentials: null,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer platform-secret',
          }),
        }),
      );
    });
  });

  describe('parseWebhookEvent', () => {
    const secret = 'whsec_test';

    it('a validly-signed payment.approved event confirms the order', () => {
      const provider = new TabbyPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          id: 'evt_1',
          event: 'payment.approved',
          payment: { id: 'pay_1', order: { reference_id: '99' } },
        }),
      );
      const result = provider.parseWebhookEvent(
        payload,
        sign(payload, secret),
        secret,
      );
      expect(result).toEqual({
        providerReference: 'evt_1',
        orderId: 99,
        status: 'paid',
        chargeReference: 'pay_1',
        advanceOrderStatus: 'confirmed',
      });
    });

    it('payment.expired and payment.closed both cancel a still-pending order', () => {
      const provider = new TabbyPaymentProvider();
      for (const event of ['payment.expired', 'payment.closed']) {
        const payload = Buffer.from(
          JSON.stringify({
            id: 'evt_2',
            event,
            payment: { id: 'pay_2', order: { reference_id: '99' } },
          }),
        );
        const result = provider.parseWebhookEvent(
          payload,
          sign(payload, secret),
          secret,
        );
        expect(result).toMatchObject({
          status: 'failed',
          advanceOrderStatus: 'cancelled',
        });
      }
    });

    it('a tampered signature is rejected — the payload is never parsed', () => {
      const provider = new TabbyPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          id: 'evt_3',
          event: 'payment.approved',
          payment: { order: { reference_id: '1' } },
        }),
      );
      const result = provider.parseWebhookEvent(
        payload,
        'not-the-real-signature',
        secret,
      );
      expect(result).toBeNull();
    });

    it('a signature computed with the wrong secret is rejected', () => {
      const provider = new TabbyPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          id: 'evt_4',
          event: 'payment.approved',
          payment: { order: { reference_id: '1' } },
        }),
      );
      const result = provider.parseWebhookEvent(
        payload,
        sign(payload, 'wrong-secret'),
        secret,
      );
      expect(result).toBeNull();
    });

    it('throws PaymentProviderNotConfiguredException when no webhook secret is configured at all', () => {
      const provider = new TabbyPaymentProvider();
      const payload = Buffer.from('{}');
      expect(() =>
        provider.parseWebhookEvent(payload, 'sig', undefined),
      ).toThrow(PaymentProviderNotConfiguredException);
    });

    it('an unrecognized event type is a safe no-op', () => {
      const provider = new TabbyPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          id: 'evt_5',
          event: 'payment.created',
          payment: { order: { reference_id: '1' } },
        }),
      );
      expect(
        provider.parseWebhookEvent(payload, sign(payload, secret), secret),
      ).toBeNull();
    });
  });
});
