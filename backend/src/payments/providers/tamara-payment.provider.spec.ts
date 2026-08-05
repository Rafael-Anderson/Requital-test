import { createHmac } from 'crypto';
import { TamaraPaymentProvider } from './tamara-payment.provider';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';

function sign(payload: Buffer, secret: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

describe('TamaraPaymentProvider', () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
    delete process.env.TAMARA_TOKEN;
    delete process.env.TAMARA_API_URL;
    delete process.env.TAMARA_NOTIFICATION_TOKEN;
  });

  describe('createCheckoutSession', () => {
    it('returns Tamara-provided checkout_url as the checkout URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          order_id: 'order_abc',
          checkout_id: 'checkout_abc',
          checkout_url: 'https://checkout.tamara.co/checkout_abc',
        }),
      });

      const provider = new TamaraPaymentProvider();
      const session = await provider.createCheckoutSession({
        orderId: 7,
        amount: 250,
        currency: 'AED',
        successUrl: 'https://shop.example/success',
        cancelUrl: 'https://shop.example/cancel',
        credentials: {
          apiToken: 'tok_test',
          apiUrl: 'https://api-sandbox.tamara.co',
        },
      });

      expect(session).toEqual({
        providerReference: 'checkout_abc',
        checkoutUrl: 'https://checkout.tamara.co/checkout_abc',
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api-sandbox.tamara.co/checkout',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer tok_test',
          }),
        }),
      );
    });

    it('throws PaymentProviderNotConfiguredException when neither per-shop nor platform credentials are set', async () => {
      const provider = new TamaraPaymentProvider();
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

    it('falls back to the platform-level env vars, including the default sandbox API URL, when unset', async () => {
      process.env.TAMARA_TOKEN = 'platform-token';
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          order_id: 'o',
          checkout_id: 'c',
          checkout_url: 'https://x',
        }),
      });

      const provider = new TamaraPaymentProvider();
      await provider.createCheckoutSession({
        orderId: 1,
        amount: 10,
        currency: 'AED',
        successUrl: 'https://x',
        cancelUrl: 'https://x',
        credentials: null,
      });
      expect(global.fetch).toHaveBeenCalledWith(
        'https://api-sandbox.tamara.co/checkout',
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: 'Bearer platform-token',
          }),
        }),
      );
    });
  });

  describe('parseWebhookEvent', () => {
    const secret = 'notif_test';

    it('a validly-signed order_approved event confirms the order', () => {
      const provider = new TamaraPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          order_id: 'order_1',
          order_reference_id: '55',
          event_type: 'order_approved',
        }),
      );
      const result = provider.parseWebhookEvent(
        payload,
        sign(payload, secret),
        secret,
      );
      expect(result).toEqual({
        providerReference: 'order_1',
        orderId: 55,
        status: 'paid',
        chargeReference: 'order_1',
        advanceOrderStatus: 'confirmed',
      });
    });

    it('order_declined and order_expired both cancel a still-pending order', () => {
      const provider = new TamaraPaymentProvider();
      for (const event_type of ['order_declined', 'order_expired']) {
        const payload = Buffer.from(
          JSON.stringify({
            order_id: 'order_2',
            order_reference_id: '55',
            event_type,
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
      const provider = new TamaraPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          order_id: 'o',
          order_reference_id: '1',
          event_type: 'order_approved',
        }),
      );
      expect(
        provider.parseWebhookEvent(payload, 'not-the-real-signature', secret),
      ).toBeNull();
    });

    it('a signature computed with the wrong secret is rejected', () => {
      const provider = new TamaraPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          order_id: 'o',
          order_reference_id: '1',
          event_type: 'order_approved',
        }),
      );
      expect(
        provider.parseWebhookEvent(
          payload,
          sign(payload, 'wrong-secret'),
          secret,
        ),
      ).toBeNull();
    });

    it('throws PaymentProviderNotConfiguredException when no notification token is configured at all', () => {
      const provider = new TamaraPaymentProvider();
      const payload = Buffer.from('{}');
      expect(() =>
        provider.parseWebhookEvent(payload, 'sig', undefined),
      ).toThrow(PaymentProviderNotConfiguredException);
    });

    it('an unrecognized event type is a safe no-op', () => {
      const provider = new TamaraPaymentProvider();
      const payload = Buffer.from(
        JSON.stringify({
          order_id: 'o',
          order_reference_id: '1',
          event_type: 'order_canceled',
        }),
      );
      expect(
        provider.parseWebhookEvent(payload, sign(payload, secret), secret),
      ).toBeNull();
    });
  });
});
