import { assertCanonicalOrder } from './canonical-order';
import { ChannelParseError, type CanonicalChannelOrder } from './channel.types';
import {
  inboxBackoffSeconds,
  INBOX_MAX_ATTEMPTS,
} from './channel-ingestion.service';
import { ChannelProviderRegistry } from './channel-provider.registry';
import {
  isMarketplaceChannel,
  MARKETPLACE_ORDER_CHANNELS,
} from './marketplace-channels';
import { IMMEDIATE_STOCK_RESERVATION_CHANNELS } from '../orders/constants';
import {
  StubChannelProvider,
  signStubDelivery,
} from './providers/stub-channel.provider';

const good = (): CanonicalChannelOrder => ({
  externalOrderId: 'X1',
  displayId: null,
  externalStatus: 'placed',
  placedAt: null,
  acceptBy: null,
  scheduledFor: null,
  currency: 'KWD',
  handover: 'marketplace_courier',
  lines: [
    {
      externalItemId: 'a',
      name: 'A',
      quantity: 1,
      unitPriceMinor: 10505,
      discountMinor: null,
      taxMinor: null,
      note: null,
    },
  ],
  totals: {
    subtotalMinor: null,
    deliveryFeeMinor: null,
    discountMinor: null,
    taxMinor: null,
    commissionMinor: null,
    totalMinor: 10505,
    cashDueMinor: null,
  },
  customer: { name: null, phone: null, address: null, notes: null },
});

describe('assertCanonicalOrder', () => {
  it('accepts a complete order with unknown (null) figures', () => {
    expect(() => assertCanonicalOrder(good())).not.toThrow();
  });
  it.each([
    [
      'fractional minor units',
      (o: CanonicalChannelOrder) => (o.lines[0].unitPriceMinor = 1.5),
    ],
    [
      'negative total',
      (o: CanonicalChannelOrder) => (o.totals.totalMinor = -1),
    ],
    ['zero quantity', (o: CanonicalChannelOrder) => (o.lines[0].quantity = 0)],
    ['no lines', (o: CanonicalChannelOrder) => (o.lines = [])],
    ['bad currency', (o: CanonicalChannelOrder) => (o.currency = 'kwd')],
    [
      'undefined commission (must be null, not absent)',
      (o: CanonicalChannelOrder) =>
        ((o.totals as unknown as Record<string, unknown>).commissionMinor =
          undefined),
    ],
    ['bad date', (o: CanonicalChannelOrder) => (o.acceptBy = 'soon')],
    [
      'unknown handover',
      (o: CanonicalChannelOrder) =>
        ((o as unknown as Record<string, unknown>).handover = 'drone'),
    ],
  ])('rejects %s', (_n, mutate) => {
    const o = good();
    mutate(o);
    expect(() => assertCanonicalOrder(o)).toThrow(ChannelParseError);
  });
});

describe('inbox retry policy', () => {
  it('backs off, caps, and is never negative', () => {
    expect(inboxBackoffSeconds(1)).toBe(5);
    expect(inboxBackoffSeconds(INBOX_MAX_ATTEMPTS)).toBe(900);
    expect(inboxBackoffSeconds(1000)).toBe(900);
  });
});

describe('marketplace channels', () => {
  it('reserve stock from arrival like checkout', () => {
    for (const c of MARKETPLACE_ORDER_CHANNELS) {
      expect(isMarketplaceChannel(c)).toBe(true);
      expect(IMMEDIATE_STOCK_RESERVATION_CHANNELS).toContain(c);
    }
    expect(isMarketplaceChannel('storefront')).toBe(false);
    expect(isMarketplaceChannel(null)).toBe(false);
  });
  it('the registry resolves by name and degrades to undefined', () => {
    const r = new ChannelProviderRegistry();
    r.register(new StubChannelProvider());
    expect(r.has('stub_marketplace')).toBe(true);
    expect(r.find('deliveroo')).toBeUndefined();
  });
});

describe('StubChannelProvider', () => {
  const p = new StubChannelProvider();
  const raw = JSON.stringify({ locationId: 'L1', type: 'noop' });
  const sig = signStubDelivery('s3cret-value', 'g1', raw);
  it('verifies only with the right secret, event id and body', () => {
    const headers = { 'x-stub-event-id': 'g1', 'x-stub-signature': sig };
    expect(
      p.verifyWebhook({
        rawBody: Buffer.from(raw),
        headers,
        secrets: ['s3cret-value'],
      }),
    ).toEqual({ valid: true, eventId: 'g1' });
    expect(
      p.verifyWebhook({
        rawBody: Buffer.from(raw),
        headers,
        secrets: ['other'],
      }).valid,
    ).toBe(false);
    expect(
      p.verifyWebhook({
        rawBody: Buffer.from(raw + ' '),
        headers,
        secrets: ['s3cret-value'],
      }).valid,
    ).toBe(false);
    expect(
      p.verifyWebhook({
        rawBody: Buffer.from(raw),
        headers: { 'x-stub-event-id': 'g2', 'x-stub-signature': sig },
        secrets: ['s3cret-value'],
      }).valid,
    ).toBe(false);
    expect(
      p.verifyWebhook({
        rawBody: Buffer.from(raw),
        headers: {},
        secrets: ['s3cret-value'],
      }).valid,
    ).toBe(false);
    expect(
      p.verifyWebhook({ rawBody: Buffer.from(raw), headers, secrets: [] })
        .valid,
    ).toBe(false);
  });
  it('extracts a routing key without trusting it, and survives garbage', () => {
    expect(p.extractRoutingKey(Buffer.from(raw))).toBe('L1');
    expect(p.extractRoutingKey(Buffer.from('nope'))).toBeNull();
  });
});
