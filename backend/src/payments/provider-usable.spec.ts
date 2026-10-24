import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { TabbyPaymentProvider } from './providers/tabby-payment.provider';
import { TamaraPaymentProvider } from './providers/tamara-payment.provider';
import { PayPalPaymentProvider } from './providers/paypal-payment.provider';
import { NomodPaymentProvider } from './providers/nomod-payment.provider';
import { TelrPaymentProvider } from './providers/telr-payment.provider';
import { PayTabsPaymentProvider } from './providers/paytabs-payment.provider';
import { PaymentProviderRegistry } from './payment-provider.registry';
import { PaymentSettingsService } from './payment-settings.service';
import type { DatabaseService } from '../database/database.service';
import type { ShopService } from '../shop/shop.service';
import type { CreateCheckoutSessionParams } from './payment-provider.interface';

jest.mock('../common/crypto', () => ({
  encrypt: (v: string) => v,
  decrypt: (v: string) => v,
}));

// F8: isUsable is the pre-commit / storefront-visibility answer, and it must agree
// with the provider's own MANDATORY GUARD (which stays in createCheckoutSession).
const ENV = [
  'STRIPE_SECRET_KEY',
  'TABBY_SECRET_KEY',
  'TABBY_PUBLIC_KEY',
  'TAMARA_TOKEN',
  'PAYPAL_CLIENT_ID',
  'PAYPAL_CLIENT_SECRET',
];
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  for (const k of ENV) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});
afterAll(() => {
  for (const k of ENV) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

const params = (
  credentials: Record<string, string> | null,
): CreateCheckoutSessionParams => ({
  orderId: 1,
  orderNumber: 1,
  amount: 10,
  currency: 'AED',
  successUrl: 'https://x.example/ok',
  cancelUrl: 'https://x.example/no',
  credentials,
});

describe('provider.isUsable agrees with each provider guard', () => {
  it.each([
    ['stripe', new StripePaymentProvider(), { secretKey: 'sk_test_x' }],
    ['tabby', new TabbyPaymentProvider(), { secretKey: 's', publicKey: 'p' }],
    ['tamara', new TamaraPaymentProvider(), { apiToken: 't' }],
    [
      'paypal',
      new PayPalPaymentProvider(),
      { clientId: 'c', clientSecret: 's' },
    ],
  ])(
    '%s: no credentials and no env key is unusable AND refuses to create a session',
    async (_n, provider, good) => {
      expect(provider.isUsable(null)).toBe(false);
      expect(provider.isUsable({})).toBe(false);
      await expect(
        provider.createCheckoutSession(params(null)),
      ).rejects.toThrow();
      expect(provider.isUsable(good)).toBe(true);
    },
  );

  it('a partial credential set is unusable for the providers that need two', () => {
    expect(new TabbyPaymentProvider().isUsable({ secretKey: 's' })).toBe(false);
    expect(new PayPalPaymentProvider().isUsable({ clientId: 'c' })).toBe(false);
  });

  it('the platform env fallback counts', () => {
    process.env.STRIPE_SECRET_KEY = 'sk_env';
    try {
      expect(new StripePaymentProvider().isUsable(null)).toBe(true);
    } finally {
      delete process.env.STRIPE_SECRET_KEY;
    }
  });

  it('the structural stubs are never usable, whatever was saved', () => {
    for (const p of [
      new NomodPaymentProvider(),
      new TelrPaymentProvider(),
      new PayTabsPaymentProvider(),
    ]) {
      expect(p.isUsable()).toBe(false);
    }
  });
});

describe('PaymentSettingsService.isUsable', () => {
  function service(rows: object[], registry: PaymentProviderRegistry) {
    const db = { query: jest.fn().mockResolvedValue(rows) };
    return new PaymentSettingsService(
      db as unknown as DatabaseService,
      {} as ShopService,
      registry,
    );
  }
  const row = (provider: string, enabled: boolean, creds?: object) => ({
    provider,
    enabled,
    credentials: creds ? JSON.stringify(creds) : null,
  });

  it('needs the toggle AND real credentials', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new TabbyPaymentProvider());
    expect(
      await service([row('tabby', true)], registry).isUsable(1, 'tabby'),
    ).toBe(false);
    expect(
      await service(
        [row('tabby', true, { secretKey: 's', publicKey: 'p' })],
        registry,
      ).isUsable(1, 'tabby'),
    ).toBe(true);
    expect(
      await service(
        [row('tabby', false, { secretKey: 's', publicKey: 'p' })],
        registry,
      ).isUsable(1, 'tabby'),
    ).toBe(false);
  });

  it('is false for a provider that is not registered, and nomod even when enabled with keys', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new NomodPaymentProvider());
    expect(
      await service(
        [row('nomod', true, { apiKey: 'a', secretKey: 's' })],
        registry,
      ).isUsable(1, 'nomod'),
    ).toBe(false);
    expect(
      await service([row('paypal', true)], registry).isUsable(1, 'paypal'),
    ).toBe(false);
  });
});
