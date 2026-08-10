import { PayPalPaymentProvider } from './paypal-payment.provider';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';

function jsonResponse(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function oauthResponse(expiresIn = 3600) {
  return jsonResponse({
    access_token: 'fake-access-token',
    expires_in: expiresIn,
  });
}

describe('PayPalPaymentProvider', () => {
  let provider: PayPalPaymentProvider;
  let fetchSpy: jest.SpyInstance;
  const originalClientId = process.env.PAYPAL_CLIENT_ID;
  const originalClientSecret = process.env.PAYPAL_CLIENT_SECRET;
  const originalWebhookId = process.env.PAYPAL_WEBHOOK_ID;

  beforeEach(() => {
    provider = new PayPalPaymentProvider();
    fetchSpy = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    if (originalClientId === undefined) delete process.env.PAYPAL_CLIENT_ID;
    else process.env.PAYPAL_CLIENT_ID = originalClientId;
    if (originalClientSecret === undefined) {
      delete process.env.PAYPAL_CLIENT_SECRET;
    } else {
      process.env.PAYPAL_CLIENT_SECRET = originalClientSecret;
    }
    if (originalWebhookId === undefined) delete process.env.PAYPAL_WEBHOOK_ID;
    else process.env.PAYPAL_WEBHOOK_ID = originalWebhookId;
  });

  describe('createCheckoutSession', () => {
    it('throws PaymentProviderNotConfiguredException when clientId/clientSecret are missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;

      await expect(
        provider.createCheckoutSession({
          orderId: 1,
          amount: 100,
          currency: 'AED',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          credentials: null,
        }),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('falls back to env credentials when no per-shop credentials are supplied', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-checkout-1';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      fetchSpy.mockResolvedValueOnce(oauthResponse()).mockResolvedValueOnce(
        jsonResponse({
          id: 'PAYPAL-ORDER-1',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/1' }],
        }),
      );

      const session = await provider.createCheckoutSession({
        orderId: 42,
        amount: 123.5,
        currency: 'AED',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        credentials: null,
      });

      expect(session).toEqual({
        providerReference: 'PAYPAL-ORDER-1',
        checkoutUrl: 'https://paypal.com/approve/1',
      });
      const [, checkoutInit] = fetchSpy.mock.calls[1];
      const sentBody = JSON.parse(checkoutInit.body);
      expect(sentBody.purchase_units[0].custom_id).toBe('42');
      expect(sentBody.purchase_units[0].amount.value).toBe('123.50');
      expect(sentBody.purchase_units[0].amount.currency_code).toBe('AED');
    });

    it('prefers per-shop credentials over env fallback', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-checkout-2';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      fetchSpy.mockResolvedValueOnce(oauthResponse()).mockResolvedValueOnce(
        jsonResponse({
          id: 'PAYPAL-ORDER-2',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/2' }],
        }),
      );

      await provider.createCheckoutSession({
        orderId: 1,
        amount: 10,
        currency: 'AED',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        credentials: {
          clientId: 'shop-client-checkout-2',
          clientSecret: 'shop-secret',
        },
      });

      const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0];
      expect(String(tokenUrl)).toContain('/v1/oauth2/token');
      expect(tokenInit.headers.Authorization).toBe(
        `Basic ${Buffer.from('shop-client-checkout-2:shop-secret').toString('base64')}`,
      );
    });

    it('throws when PayPal returns no approve link', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-checkout-3';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(
          jsonResponse({ id: 'PAYPAL-ORDER-3', links: [] }),
        );

      await expect(
        provider.createCheckoutSession({
          orderId: 1,
          amount: 10,
          currency: 'AED',
          successUrl: 'https://example.com/success',
          cancelUrl: 'https://example.com/cancel',
          credentials: null,
        }),
      ).rejects.toThrow('did not return an approve checkout URL');
    });

    it('caches the access token across calls with the same clientId', async () => {
      process.env.PAYPAL_CLIENT_ID = 'cached-client-1';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      fetchSpy.mockResolvedValue(
        jsonResponse({
          id: 'PAYPAL-ORDER-X',
          links: [{ rel: 'approve', href: 'https://paypal.com/approve/x' }],
        }),
      );
      fetchSpy.mockResolvedValueOnce(oauthResponse());

      await provider.createCheckoutSession({
        orderId: 1,
        amount: 10,
        currency: 'AED',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        credentials: null,
      });
      await provider.createCheckoutSession({
        orderId: 2,
        amount: 10,
        currency: 'AED',
        successUrl: 'https://example.com/success',
        cancelUrl: 'https://example.com/cancel',
        credentials: null,
      });

      const tokenCalls = fetchSpy.mock.calls.filter(([url]) =>
        String(url).includes('/v1/oauth2/token'),
      );
      expect(tokenCalls).toHaveLength(1);
    });
  });

  describe('parseWebhookEvent', () => {
    function headers() {
      return JSON.stringify({
        transmissionId: 'tid',
        transmissionTime: '2026-01-01T00:00:00Z',
        certUrl: 'https://api.paypal.com/cert',
        authAlgo: 'SHA256withRSA',
        transmissionSig: 'sig',
      });
    }

    it('throws PaymentProviderNotConfiguredException when webhookId is missing', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-webhook-1';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      delete process.env.PAYPAL_WEBHOOK_ID;

      await expect(
        provider.parseWebhookEvent(Buffer.from('{}'), headers(), undefined),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredException);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('decodes a bundled per-shop credentials JSON string for the 3rd param', async () => {
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(
          jsonResponse({ verification_status: 'SUCCESS' }),
        );
      const payload = Buffer.from(
        JSON.stringify({
          id: 'WH-EVT-1',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { id: 'CAPTURE-1', custom_id: '99' },
        }),
      );

      const result = await provider.parseWebhookEvent(
        payload,
        headers(),
        JSON.stringify({
          clientId: 'shop-client-webhook-1',
          clientSecret: 'shop-secret',
          webhookId: 'shop-webhook-id',
        }),
      );

      expect(result).toEqual({
        providerReference: 'WH-EVT-1',
        orderId: 99,
        status: 'paid',
        chargeReference: 'CAPTURE-1',
      });
      const [tokenUrl, tokenInit] = fetchSpy.mock.calls[0];
      expect(String(tokenUrl)).toContain('/v1/oauth2/token');
      expect(tokenInit.headers.Authorization).toBe(
        `Basic ${Buffer.from('shop-client-webhook-1:shop-secret').toString('base64')}`,
      );
      const [, verifyInit] = fetchSpy.mock.calls[1];
      const sentBody = JSON.parse(verifyInit.body);
      expect(sentBody.webhook_id).toBe('shop-webhook-id');
      expect(sentBody.transmission_id).toBe('tid');
    });

    it('returns null (safe no-op) when verification_status is not SUCCESS', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-webhook-2';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      process.env.PAYPAL_WEBHOOK_ID = 'env-webhook-id';
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(
          jsonResponse({ verification_status: 'FAILURE' }),
        );
      const payload = Buffer.from(
        JSON.stringify({
          id: 'WH-EVT-2',
          event_type: 'PAYMENT.CAPTURE.COMPLETED',
          resource: { id: 'CAPTURE-2', custom_id: '1' },
        }),
      );

      const result = await provider.parseWebhookEvent(
        payload,
        headers(),
        undefined,
      );
      expect(result).toBeNull();
    });

    it('maps PAYMENT.CAPTURE.DENIED to a failed WebhookResult', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-webhook-3';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      process.env.PAYPAL_WEBHOOK_ID = 'env-webhook-id';
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(
          jsonResponse({ verification_status: 'SUCCESS' }),
        );
      const payload = Buffer.from(
        JSON.stringify({
          id: 'WH-EVT-3',
          event_type: 'PAYMENT.CAPTURE.DENIED',
          resource: { id: 'CAPTURE-3', custom_id: '5' },
        }),
      );

      const result = await provider.parseWebhookEvent(
        payload,
        headers(),
        undefined,
      );
      expect(result).toEqual({
        providerReference: 'WH-EVT-3',
        orderId: 5,
        status: 'failed',
      });
    });

    it('returns null for an unmapped event type', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-webhook-4';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      process.env.PAYPAL_WEBHOOK_ID = 'env-webhook-id';
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(
          jsonResponse({ verification_status: 'SUCCESS' }),
        );
      const payload = Buffer.from(
        JSON.stringify({
          id: 'WH-EVT-4',
          event_type: 'CHECKOUT.ORDER.APPROVED',
          resource: { id: 'CAPTURE-4', custom_id: '5' },
        }),
      );

      const result = await provider.parseWebhookEvent(
        payload,
        headers(),
        undefined,
      );
      expect(result).toBeNull();
    });
  });

  describe('refundPayment', () => {
    it('throws PaymentProviderNotConfiguredException when credentials are missing', async () => {
      delete process.env.PAYPAL_CLIENT_ID;
      delete process.env.PAYPAL_CLIENT_SECRET;

      await expect(
        provider.refundPayment({
          chargeReference: 'CAPTURE-1',
          amount: 50,
          credentials: null,
        }),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredException);
    });

    it('issues a refund against the capture id', async () => {
      process.env.PAYPAL_CLIENT_ID = 'env-client-refund-1';
      process.env.PAYPAL_CLIENT_SECRET = 'env-secret';
      fetchSpy
        .mockResolvedValueOnce(oauthResponse())
        .mockResolvedValueOnce(jsonResponse({ id: 'REFUND-1' }));

      const result = await provider.refundPayment({
        chargeReference: 'CAPTURE-99',
        amount: 25.5,
        credentials: null,
      });

      expect(result).toEqual({ providerReference: 'REFUND-1' });
      const [refundUrl, refundInit] = fetchSpy.mock.calls[1];
      expect(String(refundUrl)).toContain(
        '/v2/payments/captures/CAPTURE-99/refund',
      );
      const sentBody = JSON.parse(refundInit.body);
      expect(sentBody.amount.value).toBe('25.50');
    });
  });
});
