import { StripePaymentProvider } from './providers/stripe-payment.provider';
import { TabbyPaymentProvider } from './providers/tabby-payment.provider';
import { TamaraPaymentProvider } from './providers/tamara-payment.provider';
import { PayPalPaymentProvider } from './providers/paypal-payment.provider';
import type { FeaturesService } from '../features/features.service';
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
    for (const p of [new TelrPaymentProvider(), new PayTabsPaymentProvider()]) {
      expect(p.isUsable()).toBe(false);
    }
  });

  it('nomod is usable only with BOTH an API key and a webhook signing secret', () => {
    const nomod = new NomodPaymentProvider();
    expect(nomod.isUsable(null)).toBe(false);
    expect(nomod.isUsable({ apiKey: 'k' })).toBe(false);
    expect(nomod.isUsable({ webhookSecret: 'whsec_x' })).toBe(false);
    expect(nomod.isUsable({ apiKey: ' ', webhookSecret: 'whsec_x' })).toBe(
      false,
    );
    expect(nomod.isUsable({ apiKey: 'k', webhookSecret: 'whsec_x' })).toBe(
      true,
    );
  });
});

const featuresStub = {
  isEnabled: jest.fn().mockResolvedValue(true),
} as unknown as FeaturesService;

describe('PaymentSettingsService.isUsable', () => {
  function service(rows: object[], registry: PaymentProviderRegistry) {
    const db = { query: jest.fn().mockResolvedValue(rows) };
    return new PaymentSettingsService(
      db as unknown as DatabaseService,
      {} as ShopService,
      registry,
      featuresStub,
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

  it('is false for a provider that is not registered', async () => {
    const registry = new PaymentProviderRegistry();
    registry.register(new NomodPaymentProvider());
    expect(
      await service([row('paypal', true)], registry).isUsable(1, 'paypal'),
    ).toBe(false);
  });

  // Nomod: the merchant's toggle, real keys, the platform grant AND an allowed
  // currency must all hold.
  describe('nomod', () => {
    const keys = { apiKey: 'a', webhookSecret: 'whsec_x' };
    function nomodService(opts: {
      rows: object[];
      currency: string;
      granted: boolean;
    }) {
      const registry = new PaymentProviderRegistry();
      registry.register(new NomodPaymentProvider());
      const db = {
        query: jest.fn((sql: string, params: unknown[]) => {
          if (sql.includes('FROM shop WHERE'))
            return Promise.resolve([{ currency: opts.currency }]);
          if (sql.includes('AND provider = ?'))
            return Promise.resolve(
              opts.rows.filter(
                (r) => (r as { provider: string }).provider === params[1],
              ),
            );
          return Promise.resolve(opts.rows);
        }),
      };
      const features = {
        isEnabled: jest.fn().mockResolvedValue(opts.granted),
      } as unknown as FeaturesService;
      return new PaymentSettingsService(
        db as unknown as DatabaseService,
        {} as ShopService,
        registry,
        features,
      );
    }

    it('is usable when enabled, keyed, granted and in an allowed currency', async () => {
      const svc = nomodService({
        rows: [row('nomod', true, keys)],
        currency: 'AED',
        granted: true,
      });
      expect(await svc.isUsable(1, 'nomod')).toBe(true);
    });

    it('is off by default: no row at all means not enabled', async () => {
      const svc = nomodService({ rows: [], currency: 'AED', granted: true });
      expect(await svc.isUsable(1, 'nomod')).toBe(false);
    });

    it('is not usable without the platform grant, however it was toggled', async () => {
      const svc = nomodService({
        rows: [row('nomod', true, keys)],
        currency: 'AED',
        granted: false,
      });
      expect(await svc.isUsable(1, 'nomod')).toBe(false);
    });

    it('is not usable without the signing secret', async () => {
      const svc = nomodService({
        rows: [row('nomod', true, { apiKey: 'a' })],
        currency: 'AED',
        granted: true,
      });
      expect(await svc.isUsable(1, 'nomod')).toBe(false);
    });

    it.each([
      ['AED', true],
      ['USD', true],
      ['EUR', true],
      ['GBP', true],
      ['SAR', true],
      ['KWD', false],
      ['QAR', false],
      ['BHD', false],
      ['OMR', false],
    ])('currency %s usable: %s', async (currency, ok) => {
      const svc = nomodService({
        rows: [row('nomod', true, keys)],
        currency,
        granted: true,
      });
      expect(await svc.isUsable(1, 'nomod')).toBe(ok);
    });
  });

  // Stripe is not usable for a shop whose currency is KWD/BHD/OMR (checkout is
  // blocked), so getShop hides "Pay online" and the order is refused before it
  // exists. Other gateways and other currencies are untouched.
  it.each([
    ['KWD', false],
    ['BHD', false],
    ['OMR', false],
    ['AED', true],
    ['SAR', true],
  ])('stripe with valid keys for a %s shop is usable: %s', async (cur, ok) => {
    const registry = new PaymentProviderRegistry();
    registry.register(new StripePaymentProvider());
    registry.register(new TabbyPaymentProvider());
    const rows = [
      row('stripe', true, { secretKey: 'sk_x' }),
      row('tabby', true, { secretKey: 's', publicKey: 'p' }),
    ];
    const db = {
      query: jest.fn((sql: string, params: unknown[]) => {
        if (sql.includes('FROM shop WHERE'))
          return Promise.resolve([{ currency: cur }]);
        // resolveCredentials asks for one provider's row; isEnabled for all.
        if (sql.includes('AND provider = ?'))
          return Promise.resolve(rows.filter((r) => r.provider === params[1]));
        return Promise.resolve(rows);
      }),
    };
    const svc = new PaymentSettingsService(
      db as unknown as DatabaseService,
      {} as ShopService,
      registry,
      featuresStub,
    );
    expect(await svc.isUsable(1, 'stripe')).toBe(ok);
    // Tabby is never blocked, whatever the currency.
    expect(await svc.isUsable(1, 'tabby')).toBe(true);
  });
});
