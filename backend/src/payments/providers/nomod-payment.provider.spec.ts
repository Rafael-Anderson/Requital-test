import { NomodPaymentProvider } from './nomod-payment.provider';
import { NomodApiError, type NomodClient } from '../nomod/nomod-client';
import type { NomodPaymentService } from '../nomod/nomod-payment.service';
import { RefundNotAttemptedError } from '../payment-provider.interface';
import { PaymentProviderNotConfiguredException } from '../payment-provider-not-configured.exception';
import { PaymentCurrencyNotSupportedException } from '../blocked-gateway-currencies';

const goodCreds = { apiKey: 'k', webhookSecret: 'whsec_x' };

function clientWith(over: Partial<Record<keyof NomodClient, jest.Mock>>) {
  return {
    getCheckout: jest.fn(),
    refund: jest.fn(),
    ...over,
  } as unknown as NomodClient & {
    getCheckout: jest.Mock;
    refund: jest.Mock;
  };
}

describe('NomodPaymentProvider.createCheckoutSession guards', () => {
  const payments = {
    createCheckout: jest.fn(),
  } as unknown as NomodPaymentService & {
    createCheckout: jest.Mock;
  };
  const provider = new NomodPaymentProvider(payments);
  const params = {
    orderId: 1,
    shopId: 1,
    orderNumber: 1,
    amount: 10,
    currency: 'AED',
    successUrl: 'https://s/x',
    cancelUrl: 'https://s/y',
    credentials: goodCreds,
  };

  beforeEach(() => payments.createCheckout.mockReset());

  it('refuses without credentials, whatever a toggle says (MANDATORY GUARD)', async () => {
    const missing: (Record<string, string> | null | undefined)[] = [
      null,
      undefined,
      {},
      { apiKey: 'k' },
      { webhookSecret: 'w' },
    ];
    for (const credentials of missing) {
      await expect(
        provider.createCheckoutSession({ ...params, credentials }),
      ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredException);
    }
    expect(payments.createCheckout).not.toHaveBeenCalled();
  });

  it('refuses a currency Nomod does not take, before doing anything', async () => {
    for (const currency of ['KWD', 'QAR', 'BHD', 'OMR', 'JPY']) {
      await expect(
        provider.createCheckoutSession({ ...params, currency }),
      ).rejects.toBeInstanceOf(PaymentCurrencyNotSupportedException);
    }
    expect(payments.createCheckout).not.toHaveBeenCalled();
  });

  it('delegates a valid request', async () => {
    payments.createCheckout.mockResolvedValue({
      providerReference: 'c',
      checkoutUrl: 'https://p',
    });
    await expect(provider.createCheckoutSession(params)).resolves.toEqual({
      providerReference: 'c',
      checkoutUrl: 'https://p',
    });
  });

  it('a provider built with no service refuses everything', async () => {
    await expect(
      new NomodPaymentProvider().createCheckoutSession(params),
    ).rejects.toBeInstanceOf(PaymentProviderNotConfiguredException);
  });
});

describe('NomodPaymentProvider.refundPayment', () => {
  const base = {
    chargeReference: 'chk_1',
    amount: 100,
    currency: 'AED',
    idempotencyKey: 'key-abc',
    credentials: goodCreds,
  };
  const charged = {
    id: 'chk_1',
    status: 'paid',
    amount: '100.00',
    currency: 'AED',
  };

  it('refunds the whole charge with the idempotency key and our own amount', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 'rf_1', status: 'pending' }),
    });
    const res = await new NomodPaymentProvider(undefined, client).refundPayment(
      base,
    );
    expect(res).toEqual({ providerReference: 'rf_1', status: 'pending' });
    expect(client.refund).toHaveBeenCalledWith(
      expect.objectContaining({ apiKey: 'k' }),
      'chk_1',
      { amount: '100.00', idempotencyKey: 'key-abc' },
    );
  });

  it('reports completed when Nomod says so', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 'rf_1', status: 'completed' }),
    });
    const res = await new NomodPaymentProvider(undefined, client).refundPayment(
      base,
    );
    expect(res.status).toBe('completed');
  });

  it('refuses a PARTIAL refund unless the shop turned partial refunds on', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest.fn(),
    });
    await expect(
      new NomodPaymentProvider(undefined, client).refundPayment({
        ...base,
        amount: 40,
      }),
    ).rejects.toBeInstanceOf(RefundNotAttemptedError);
    expect(client.refund).not.toHaveBeenCalled();
  });

  it('allows a partial refund when the setting is on', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 'rf_2', status: 'pending' }),
    });
    await new NomodPaymentProvider(undefined, client).refundPayment({
      ...base,
      amount: 40,
      credentials: { ...goodCreds, allowPartialRefunds: 'true' },
    });
    expect(client.refund).toHaveBeenCalledWith(expect.anything(), 'chk_1', {
      amount: '40.00',
      idempotencyKey: 'key-abc',
    });
  });

  it('only the exact string "true" turns partial refunds on', async () => {
    for (const v of ['1', 'yes', 'TRUE', 'false', '']) {
      const client = clientWith({
        getCheckout: jest.fn().mockResolvedValue(charged),
        refund: jest.fn(),
      });
      await expect(
        new NomodPaymentProvider(undefined, client).refundPayment({
          ...base,
          amount: 40,
          credentials: { ...goodCreds, allowPartialRefunds: v },
        }),
      ).rejects.toThrow();
      expect(client.refund).not.toHaveBeenCalled();
    }
  });

  it('never refunds more than the charge, or in another currency', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest.fn(),
    });
    const p = new NomodPaymentProvider(undefined, client);
    await expect(
      p.refundPayment({ ...base, amount: 100.01 }),
    ).rejects.toThrow();
    await expect(
      p.refundPayment({ ...base, currency: 'USD' }),
    ).rejects.toThrow();
    expect(client.refund).not.toHaveBeenCalled();
  });

  it('requires an idempotency key (a random one would turn a retry into a second refund)', async () => {
    const client = clientWith({ getCheckout: jest.fn(), refund: jest.fn() });
    await expect(
      new NomodPaymentProvider(undefined, client).refundPayment({
        ...base,
        idempotencyKey: undefined,
      }),
    ).rejects.toThrow(/idempotency/);
    expect(client.getCheckout).not.toHaveBeenCalled();
  });

  it('a refund Nomod reports as failed throws, so the caller keeps it retryable', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 'rf_3', status: 'failed' }),
    });
    await expect(
      new NomodPaymentProvider(undefined, client).refundPayment(base),
    ).rejects.toThrow(/failed/);
  });

  it('an API error propagates (and the same key is reused on the retry)', async () => {
    const refund = jest
      .fn()
      .mockRejectedValueOnce(new NomodApiError('x', 500, true))
      .mockResolvedValueOnce({ refundId: 'rf_4', status: 'pending' });
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund,
    });
    const p = new NomodPaymentProvider(undefined, client);
    await expect(p.refundPayment(base)).rejects.toBeInstanceOf(NomodApiError);
    await p.refundPayment(base);
    const keys = refund.mock.calls.map(
      (c) => ((c as unknown[])[2] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys).toEqual(['key-abc', 'key-abc']);
  });

  it('does not use the amount Nomod puts in a response (an integer in the docs)', async () => {
    const client = clientWith({
      getCheckout: jest.fn().mockResolvedValue(charged),
      refund: jest
        .fn()
        .mockResolvedValue({ refundId: 'rf_5', status: 'pending' }),
    });
    const res = await new NomodPaymentProvider(undefined, client).refundPayment(
      base,
    );
    expect(res).not.toHaveProperty('amount');
  });
});

describe('NomodPaymentProvider.retrieveSessionOutcome', () => {
  const row = {
    id: 1,
    shopId: 1,
    orderId: 5,
    checkoutId: 'chk_1',
    amountMinor: 100,
    currency: 'AED',
  };
  function svc(kind: string) {
    return {
      findByCheckoutId: jest.fn().mockResolvedValue(row),
      inspect: jest.fn().mockResolvedValue({ kind }),
    } as unknown as NomodPaymentService;
  }

  it('paid carries the checkout id as the charge reference', async () => {
    expect(
      await new NomodPaymentProvider(svc('paid')).retrieveSessionOutcome(
        'chk_1',
        goodCreds,
      ),
    ).toEqual({ status: 'paid', chargeReference: 'chk_1' });
  });

  it('a mismatch reads as unpaid, so the sweep can never mark it paid', async () => {
    expect(
      await new NomodPaymentProvider(svc('review')).retrieveSessionOutcome(
        'chk_1',
        goodCreds,
      ),
    ).toEqual({ status: 'unpaid' });
  });

  it('expired and cancelled are terminal', async () => {
    for (const kind of ['expired', 'cancelled']) {
      expect(
        await new NomodPaymentProvider(svc(kind)).retrieveSessionOutcome(
          'chk_1',
          goodCreds,
        ),
      ).toEqual({ status: 'expired' });
    }
  });

  it('an unknown checkout id is null', async () => {
    const s = {
      findByCheckoutId: jest.fn().mockResolvedValue(null),
    } as unknown as NomodPaymentService;
    expect(
      await new NomodPaymentProvider(s).retrieveSessionOutcome(
        'nope',
        goodCreds,
      ),
    ).toBeNull();
  });
});
