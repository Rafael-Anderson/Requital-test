import { StripePaymentProvider } from './stripe-payment.provider';

describe('StripePaymentProvider.testConnection', () => {
  it('ok when the balance read succeeds with the shop key', async () => {
    const reader = jest.fn().mockResolvedValue({});
    const p = new StripePaymentProvider(reader);
    await expect(
      p.testConnection({ secretKey: ' sk_test_abc ' }),
    ).resolves.toEqual({
      ok: true,
      rejected: false,
      message: 'Stripe accepted the secret key.',
    });
    expect(reader).toHaveBeenCalledWith('sk_test_abc');
  });

  it('rejected on an authentication_error', async () => {
    const p = new StripePaymentProvider(() =>
      Promise.reject(
        Object.assign(new Error('Invalid API Key provided: sk_test_***'), {
          type: 'StripeAuthenticationError',
          rawType: 'authentication_error',
        }),
      ),
    );
    const r = await p.testConnection({ secretKey: 'sk_test_abc' });
    expect(r).toMatchObject({ ok: false, rejected: true });
    // The provider's own message (which may echo part of the key) never leaks.
    expect(r.message).toBe('Stripe rejected the secret key.');
  });

  it('a network error is not a rejection', async () => {
    const p = new StripePaymentProvider(() =>
      Promise.reject(
        Object.assign(new Error('x'), { type: 'StripeConnectionError' }),
      ),
    );
    await expect(
      p.testConnection({ secretKey: 'sk_test_abc' }),
    ).resolves.toEqual({
      ok: false,
      rejected: false,
      message: 'Could not reach Stripe.',
    });
  });

  it('no saved key: nothing is called', async () => {
    const reader = jest.fn();
    const p = new StripePaymentProvider(reader);
    const r = await p.testConnection(null);
    expect(r).toMatchObject({ ok: false, rejected: false });
    expect(reader).not.toHaveBeenCalled();
  });

  it('never calls Stripe under NODE_ENV=test without an injected reader', async () => {
    const p = new StripePaymentProvider();
    await expect(
      p.testConnection({ secretKey: 'sk_test_abc' }),
    ).resolves.toEqual({
      ok: false,
      rejected: false,
      message: 'Could not reach Stripe.',
    });
  });
});
