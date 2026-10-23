import { createHash } from 'crypto';
import { purchaseEventId } from './meta-capi';
import { buildTiktokPurchaseEvent, TiktokEventsClient } from './tiktok-events';
import { buildSnapPurchaseEvent, SnapCapiClient } from './snap-capi';
import {
  SNAP_ASSUMPTIONS,
  TIKTOK_ASSUMPTIONS,
  hashPhoneForAdPlatform,
} from './conversion-platform-assumptions';
import { conversionIdempotencyKey } from './conversion-events.service';
import { FakeConversionClient } from './conversion-clients.fake';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const TOKEN = 'tt_SECRETtokenvalue1234567890abcdef';

const input = {
  eventId: purchaseEventId(42),
  eventTimeSeconds: 1_790_000_000,
  value: '105.50',
  currency: 'AED',
  orderId: 42,
  customerEmail: ' Jane.Doe@Example.com ',
  customerPhone: '050 123 4567',
  shopCountryCode: 'AE',
  items: [{ productId: 7, quantity: 2, unitPrice: '50.00' }],
  attribution: {
    v: 1 as const,
    consent: { marketing: true },
    firstTouch: { ttclid: 'TT-FIRST' },
    lastTouch: { ttclid: 'TT-LAST' },
    clientUserAgent: 'Mozilla/5.0 (unit)',
  },
  eventSourceUrl: 'https://shop.requital.io/',
};

describe('platform assumptions (UNVERIFIED, one place)', () => {
  it('event names match the storefront browser vocabulary so the pair dedupes', () => {
    expect(TIKTOK_ASSUMPTIONS.eventName).toBe('CompletePayment');
    expect(SNAP_ASSUMPTIONS.eventName).toBe('PURCHASE');
  });
  it('phone normalisation differs per platform and omits garbage', () => {
    expect(hashPhoneForAdPlatform('0501234567', 'AE', true)).toBe(sha('+971501234567'));
    expect(hashPhoneForAdPlatform('0501234567', 'AE', false)).toBe(sha('971501234567'));
    expect(hashPhoneForAdPlatform('abc', 'AE', true)).toBeNull();
  });
  it('idempotency keys: Meta unchanged, others namespaced', () => {
    expect(conversionIdempotencyKey('meta', 5)).toBe('capi:purchase:5');
    expect(conversionIdempotencyKey('tiktok', 5)).toBe('capi:tiktok:purchase:5');
    expect(conversionIdempotencyKey('snap', 5)).toBe('capi:snap:purchase:5');
  });
});

describe('buildTiktokPurchaseEvent', () => {
  const e = buildTiktokPurchaseEvent(input);
  it('shapes the event with the shared event id and hashed contact data only', () => {
    expect(e.event).toBe('CompletePayment');
    expect(e.event_id).toBe('order_42');
    expect(e.user.email).toBe(sha('jane.doe@example.com'));
    expect(e.user.phone).toBe(sha('+971501234567'));
    expect(e.user.ttclid).toBe('TT-LAST');
    expect(e.properties).toMatchObject({ currency: 'AED', value: 105.5, order_id: '42' });
    expect(JSON.stringify(e)).not.toMatch(/jane\.doe|example\.com|0501234567/i);
  });
  it('sends no IP and no click id / user agent without attribution', () => {
    expect(JSON.stringify(e)).not.toMatch(/"ip"/);
    const bare = buildTiktokPurchaseEvent({ ...input, attribution: null });
    expect(bare.user).not.toHaveProperty('ttclid');
    expect(bare.user).not.toHaveProperty('user_agent');
  });
});

describe('buildSnapPurchaseEvent', () => {
  const e = buildSnapPurchaseEvent(input);
  it('shapes the event with the shared event id and hashed contact data only', () => {
    expect(e.event_name).toBe('PURCHASE');
    expect(e.event_id).toBe('order_42');
    expect(e.user_data.em).toEqual([sha('jane.doe@example.com')]);
    expect(e.user_data.ph).toEqual([sha('971501234567')]);
    expect(JSON.stringify(e)).not.toMatch(/jane\.doe|example\.com|0501234567|"ip"/i);
  });
  it('omits user agent without attribution', () => {
    expect(buildSnapPurchaseEvent({ ...input, attribution: null }).user_data).not.toHaveProperty(
      'client_user_agent',
    );
  });
});

describe.each([
  ['TiktokEventsClient', () => new TiktokEventsClient(), { pixelCode: 'CABCDEFGHIJ' }],
  ['SnapCapiClient', () => new SnapCapiClient(), { pixelId: '1b2c3d4e-0000-4000-8000-123456789abc' }],
])('%s secret handling', (_name, make, ids) => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  const call = () =>
    (make() as { send: (p: unknown) => Promise<void> }).send({
      ...ids,
      accessToken: TOKEN,
      events: [{}],
    });

  it('puts the token in a header, never the URL or the body', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ code: 0 }) });
    global.fetch = fetchMock as unknown as typeof fetch;
    await call();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect(init.body as string).not.toContain(TOKEN);
    expect(JSON.stringify(init.headers)).toContain(TOKEN);
  });

  it('an HTTP failure carries status and a numeric/short code, never the token or body text', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 401,
      json: () =>
        Promise.resolve({ code: 40001, message: `bad token ${TOKEN}`, error: { code: 'E401', message: TOKEN } }),
    }) as unknown as typeof fetch;
    const err = (await call().catch((e: Error) => e)) as Error;
    expect(err.message).toContain('HTTP 401');
    expect(err.message).not.toContain(TOKEN);
    expect(err.message).not.toContain('bad token');
  });

  it('a network error is rethrown without the original text', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error(`connect failed ${TOKEN}`)) as unknown as typeof fetch;
    const err = (await call().catch((e: Error) => e)) as Error;
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('TiktokEventsClient body-level failure', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });
  it('HTTP 200 with a non-zero code is a failure (UNVERIFIED assumption)', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ code: 40002, message: TOKEN }),
    }) as unknown as typeof fetch;
    const err = (await new TiktokEventsClient()
      .send({ pixelCode: 'C', accessToken: TOKEN, events: [] })
      .catch((e: Error) => e)) as Error;
    expect(err.message).toContain('code=40002');
    expect(err.message).not.toContain(TOKEN);
  });
});

describe('FakeConversionClient', () => {
  it('records calls and fails once on demand', async () => {
    const f = new FakeConversionClient<{ a: number }>();
    await f.send({ a: 1 });
    f.failNext = 'boom';
    await expect(f.send({ a: 2 })).rejects.toThrow('boom');
    await f.send({ a: 3 });
    expect(f.calls.map((c) => c.a)).toEqual([1, 2, 3]);
  });
});
