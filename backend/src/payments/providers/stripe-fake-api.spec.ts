import { fakeStripeApi } from './stripe-payment.provider';

describe('fakeStripeApi (the Playwright fake Stripe gate)', () => {
  const saved = { url: process.env.E2E_FAKE_STRIPE_URL, env: process.env.NODE_ENV };
  afterEach(() => {
    if (saved.url === undefined) delete process.env.E2E_FAKE_STRIPE_URL;
    else process.env.E2E_FAKE_STRIPE_URL = saved.url;
    process.env.NODE_ENV = saved.env;
  });

  it('is off when unset', () => {
    delete process.env.E2E_FAKE_STRIPE_URL;
    expect(fakeStripeApi()).toBeNull();
  });

  it('points at a local origin outside production', () => {
    process.env.NODE_ENV = 'development';
    process.env.E2E_FAKE_STRIPE_URL = 'http://127.0.0.1:12111';
    expect(fakeStripeApi()).toEqual({ host: '127.0.0.1', port: 12111, protocol: 'http' });
  });

  it('is ignored in production and for any non-local host', () => {
    process.env.E2E_FAKE_STRIPE_URL = 'http://127.0.0.1:12111';
    process.env.NODE_ENV = 'production';
    expect(fakeStripeApi()).toBeNull();
    process.env.NODE_ENV = 'development';
    for (const u of ['http://evil.example:80', 'https://api.stripe.com', 'http://127.0.0.1.evil.com', 'ftp://localhost', 'nonsense']) {
      process.env.E2E_FAKE_STRIPE_URL = u;
      expect(fakeStripeApi()).toBeNull();
    }
  });
});
