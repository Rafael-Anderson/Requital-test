import {
  NomodApiError,
  NomodClient,
  NomodConfigError,
  resolveNomodBase,
} from './nomod-client';
import { buildNomodAmounts } from './nomod-money';

const amounts = buildNomodAmounts({
  currency: 'AED',
  total: '100.00',
  deliveryFee: null,
  taxAmount: null,
  discountAmount: null,
  giftCardAmount: null,
  storeCreditAmount: null,
  lines: [{ id: 1, name: 'Roses', quantity: 1, unitPrice: '100.00' }],
});

function reply(status: number, body: unknown): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

const noSleep = () => Promise.resolve();
const creds = { apiKey: 'sk_test_SECRET_KEY' };

describe('resolveNomodBase (SSRF guard)', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('defaults to https://api.nomod.com', () => {
    expect(resolveNomodBase()).toBe('https://api.nomod.com');
    expect(resolveNomodBase('')).toBe('https://api.nomod.com');
  });

  it('accepts the documented hosts', () => {
    expect(resolveNomodBase('https://api.nomod.dev')).toBe(
      'https://api.nomod.dev',
    );
    expect(resolveNomodBase('https://API.NOMOD.COM/')).toBe(
      'https://api.nomod.com',
    );
  });

  it.each([
    'http://api.nomod.com',
    'https://evil.example.com',
    'https://api.nomod.com.evil.example.com',
    'https://evil.example.com/api.nomod.com',
    'https://user:pw@api.nomod.com',
    'https://api.nomod.com:8443',
    'https://api.nomod.com/v1',
    'https://api.nomod.com/?x=1',
    'https://169.254.169.254',
    'https://localhost',
    'https://127.0.0.1',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url',
  ])('refuses %s', (url) => {
    expect(() => resolveNomodBase(url)).toThrow(NomodConfigError);
  });

  it('the platform can add a host; a shop cannot', () => {
    process.env.NOMOD_ALLOWED_HOSTS = 'sandbox.nomod.example';
    expect(resolveNomodBase('https://sandbox.nomod.example')).toBe(
      'https://sandbox.nomod.example',
    );
    delete process.env.NOMOD_ALLOWED_HOSTS;
    expect(() => resolveNomodBase('https://sandbox.nomod.example')).toThrow();
  });
});

describe('NomodClient.createCheckout', () => {
  const input = {
    referenceId: '42',
    amounts,
    customer: { first_name: 'A', last_name: 'B' },
    successUrl: 'https://shop.test/orders/T',
    failureUrl: 'https://shop.test/checkout?orderId=42&payment=failed',
    cancelledUrl: 'https://shop.test/checkout?orderId=42&payment=cancelled',
    metadata: { orderid: '42' },
  };

  it('POSTs the documented body with the X-API-KEY header to /v1/checkout', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(
      reply(200, {
        id: 'chk_1',
        url: 'https://pay.nomod.com/c/1',
        status: 'created',
      }),
    );
    const client = new NomodClient(fetchImpl, noSleep);
    const res = await client.createCheckout(creds, input);
    expect(res).toMatchObject({
      id: 'chk_1',
      url: 'https://pay.nomod.com/c/1',
    });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.nomod.com/v1/checkout');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-API-KEY']).toBe(
      creds.apiKey,
    );
    expect(init.redirect).toBe('manual');
    const body = JSON.parse(init.body as string) as {
      items: unknown[];
    } & Record<string, unknown>;
    expect(body).toMatchObject({
      reference_id: '42',
      amount: '100.00',
      currency: 'AED',
      success_url: input.successUrl,
      failure_url: input.failureUrl,
      cancelled_url: input.cancelledUrl,
      customer: { first_name: 'A', last_name: 'B' },
      metadata: { orderid: '42' },
    });
    expect(body.items).toHaveLength(1);
    expect(body).not.toHaveProperty('discount');
  });

  it('honours an allow-listed base URL override', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        reply(200, { id: 'c', url: 'https://pay.nomod.dev/c' }),
      );
    await new NomodClient(fetchImpl, noSleep).createCheckout(
      { ...creds, baseUrl: 'https://api.nomod.dev' },
      input,
    );
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.nomod.dev/v1/checkout',
    );
  });

  it('never calls out for a disallowed base URL', async () => {
    const fetchImpl = jest.fn();
    await expect(
      new NomodClient(fetchImpl, noSleep).createCheckout(
        { ...creds, baseUrl: 'https://evil.example.com' },
        input,
      ),
    ).rejects.toBeInstanceOf(NomodConfigError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POST is never retried, even on a 500 or a network error', async () => {
    const five = jest.fn().mockResolvedValue(reply(500, {}));
    await expect(
      new NomodClient(five, noSleep).createCheckout(creds, input),
    ).rejects.toMatchObject({ status: 500, ambiguous: true });
    expect(five).toHaveBeenCalledTimes(1);

    const down = jest.fn().mockRejectedValue(new Error('ECONNRESET'));
    await expect(
      new NomodClient(down, noSleep).createCheckout(creds, input),
    ).rejects.toMatchObject({ status: null, ambiguous: true });
    expect(down).toHaveBeenCalledTimes(1);
  });

  it('treats 400, 401 and any undocumented status as one generic gateway error', async () => {
    for (const status of [400, 401, 403, 404, 409, 422, 302, 204]) {
      const fetchImpl = jest
        .fn()
        .mockResolvedValue(reply(status, { detail: 'secret detail' }));
      const err = await new NomodClient(fetchImpl, noSleep)
        .createCheckout(creds, input)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(NomodApiError);
      expect((err as NomodApiError).message).not.toContain('secret detail');
      expect((err as NomodApiError).status).toBe(status);
    }
  });

  it('an unparsable body is a gateway error', async () => {
    const fetchImpl = jest.fn().mockResolvedValue({
      status: 200,
      json: () => Promise.reject(new Error('bad json')),
    });
    await expect(
      new NomodClient(fetchImpl as never, noSleep).createCheckout(creds, input),
    ).rejects.toBeInstanceOf(NomodApiError);
  });

  it('rejects a 200 with no id or with a non-https checkout URL', async () => {
    for (const body of [
      { url: 'https://pay.nomod.com/x' },
      { id: 'c', url: 'http://pay.nomod.com/x' },
      { id: 'c', url: 'javascript:alert(1)' },
      { id: 'c' },
    ]) {
      const fetchImpl = jest.fn().mockResolvedValue(reply(200, body));
      await expect(
        new NomodClient(fetchImpl, noSleep).createCheckout(creds, input),
      ).rejects.toBeInstanceOf(NomodApiError);
    }
  });

  it('errors never contain the API key', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(500, {}));
    const err = (await new NomodClient(fetchImpl, noSleep)
      .createCheckout(creds, input)
      .catch((e: unknown) => e)) as Error;
    expect(`${err.message} ${JSON.stringify(err)}`).not.toContain('SECRET_KEY');
  });

  it('requires an API key', async () => {
    const fetchImpl = jest.fn();
    await expect(
      new NomodClient(fetchImpl, noSleep).createCheckout(
        { apiKey: ' ' },
        input,
      ),
    ).rejects.toBeInstanceOf(NomodApiError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('NomodClient.getCheckout', () => {
  it('retries an idempotent GET on 5xx and on a network error, then succeeds', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce(reply(503, {}))
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce(
        reply(200, {
          id: 'c1',
          status: 'paid',
          amount: '45.00',
          currency: 'AED',
        }),
      );
    const res = await new NomodClient(fetchImpl, noSleep).getCheckout(
      creds,
      'c1',
    );
    expect(res).toMatchObject({ id: 'c1', status: 'paid', currency: 'AED' });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect((fetchImpl.mock.calls[0] as [string])[0]).toBe(
      'https://api.nomod.com/v1/checkout/c1',
    );
  });

  it('gives up after three attempts', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(502, {}));
    await expect(
      new NomodClient(fetchImpl, noSleep).getCheckout(creds, 'c1'),
    ).rejects.toMatchObject({ status: 502 });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('does not retry a 4xx', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(404, {}));
    await expect(
      new NomodClient(fetchImpl, noSleep).getCheckout(creds, 'c1'),
    ).rejects.toMatchObject({ status: 404 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('refuses an id that could change the path', async () => {
    const fetchImpl = jest.fn();
    for (const id of ['../x', 'a/b', 'a?b=1', 'a b', '', 'x'.repeat(101)]) {
      await expect(
        new NomodClient(fetchImpl, noSleep).getCheckout(creds, id),
      ).rejects.toBeInstanceOf(NomodApiError);
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('NomodClient.refund', () => {
  it('POSTs amount and idempotency_key, and ignores the response amount', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(
        reply(200, { refund_id: 'rf_1', status: 'pending', amount: 4500 }),
      );
    const res = await new NomodClient(fetchImpl, noSleep).refund(creds, 'c1', {
      amount: '45.00',
      idempotencyKey: 'key-1',
    });
    expect(res).toEqual({ refundId: 'rf_1', status: 'pending' });
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.nomod.com/v1/checkout/c1/refund');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: '45.00',
      idempotency_key: 'key-1',
    });
  });

  it('is never retried by the client', async () => {
    const fetchImpl = jest.fn().mockResolvedValue(reply(500, {}));
    await expect(
      new NomodClient(fetchImpl, noSleep).refund(creds, 'c1', {
        amount: '1.00',
        idempotencyKey: 'k',
      }),
    ).rejects.toBeInstanceOf(NomodApiError);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('a 200 with no refund id is an (ambiguous) error', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValue(reply(200, { status: 'completed' }));
    await expect(
      new NomodClient(fetchImpl, noSleep).refund(creds, 'c1', {
        amount: '1.00',
        idempotencyKey: 'k',
      }),
    ).rejects.toMatchObject({ ambiguous: true });
  });
});

describe('NomodClient.testConnection', () => {
  it('accepts a 404 or 400 as "key accepted"', async () => {
    for (const status of [404, 400]) {
      const r = await new NomodClient(
        jest.fn().mockResolvedValue(reply(status, {})),
        noSleep,
      ).testConnection(creds);
      expect(r.ok).toBe(true);
    }
  });

  it('401/403 means the key was rejected', async () => {
    for (const status of [401, 403]) {
      const r = await new NomodClient(
        jest.fn().mockResolvedValue(reply(status, {})),
        noSleep,
      ).testConnection(creds);
      expect(r).toEqual({ ok: false, message: 'Nomod rejected the API key.' });
    }
  });

  it('network failure and a bad base URL are plain messages, never the key', async () => {
    const down = await new NomodClient(
      jest.fn().mockRejectedValue(new Error('down')),
      noSleep,
    ).testConnection(creds);
    expect(down.ok).toBe(false);
    const bad = await new NomodClient(jest.fn(), noSleep).testConnection({
      ...creds,
      baseUrl: 'https://evil.example.com',
    });
    expect(bad.ok).toBe(false);
    expect(JSON.stringify([down, bad])).not.toContain('SECRET_KEY');
  });
});
