import {
  ChannelParseError,
  NO_CAPABILITIES,
  type BoundChannelConnection,
  type CanonicalChannelOrder,
  type CanonicalOrderStatus,
  type ChannelProvider,
  type ParsedChannelEvent,
  type ProviderCallResult,
  type VerifyWebhookInput,
  type VerifyWebhookResult,
} from '../channel.types';
import { assertCanonicalOrder } from '../canonical-order';
import { hmacSha256Hex, safeEqualHex } from '../hmac';

// Deterministic, offline marketplace used by every test and by local
// development. It exists so the whole pipeline (signature, inbox, mapping,
// order creation, accept/reject, cancellation, polling) is exercised with no
// credentials and no network. NEVER registered in production (see
// ChannelsModule) because it claims to prove location ownership.
//
// Wire format, mirroring Deliveroo's scheme (HMAC-SHA256 over `<guid> <raw body>`):
//   header x-stub-event-id   : the delivery's unique id
//   header x-stub-signature  : hex HMAC-SHA256(secret, `${eventId} ${rawBody}`)
//   body   : { type: 'order.new' | 'order.status' | 'noop', locationId,
//              externalOrderId?, status?, externalStatus?, order?: CanonicalChannelOrder }
export const STUB_PROVIDER = 'stub_marketplace';

export function signStubDelivery(
  secret: string,
  eventId: string,
  rawBody: string,
): string {
  return hmacSha256Hex(secret, `${eventId} ${rawBody}`);
}

const STATUSES: CanonicalOrderStatus[] = [
  'placed',
  'accepted',
  'rejected',
  'cancelled',
  'ready',
  'dispatched',
  'delivered',
  'other',
];

export interface StubCall {
  method: string;
  externalOrderId?: string;
  detail?: unknown;
}

export class StubChannelProvider implements ChannelProvider {
  readonly name = STUB_PROVIDER;
  readonly capabilities = {
    ...NO_CAPABILITIES,
    acceptReject: true,
    markReady: true,
    itemAvailability: true,
    fetchOrderStatus: true,
    pollOrders: true,
    provesLocationOwnership: true,
  };

  // Test seams. A static log is fine: the provider is a process-wide singleton
  // in the app under test and tests reset it in beforeEach.
  readonly calls: StubCall[] = [];
  // Methods that should throw once, e.g. failNext.add('acceptOrder').
  readonly failNext = new Set<string>();
  // Open orders per location id for listOpenOrders (the polling fallback).
  readonly openOrders = new Map<
    string,
    { eventId: string; payload: unknown }[]
  >();
  // Status per external order id for fetchOrderStatus.
  readonly statuses = new Map<string, CanonicalOrderStatus>();
  // What testConnection answers; flip to false to model a bad credential.
  testConnectionOk = true;

  reset(): void {
    this.calls.length = 0;
    this.failNext.clear();
    this.openOrders.clear();
    this.statuses.clear();
    this.testConnectionOk = true;
  }

  private header(
    headers: Record<string, string | string[] | undefined>,
    name: string,
  ): string | null {
    const v = headers[name];
    const s = Array.isArray(v) ? v[0] : v;
    return typeof s === 'string' && s.length > 0 ? s : null;
  }

  extractRoutingKey(rawBody: Buffer): string | null {
    try {
      const body = JSON.parse(rawBody.toString('utf8')) as {
        locationId?: unknown;
      };
      return typeof body.locationId === 'string' && body.locationId.length > 0
        ? body.locationId
        : null;
    } catch {
      return null;
    }
  }

  verifyWebhook(input: VerifyWebhookInput): VerifyWebhookResult {
    const eventId = this.header(input.headers, 'x-stub-event-id');
    const signature = this.header(input.headers, 'x-stub-signature');
    if (!eventId || !signature) return { valid: false, eventId: null };
    const body = input.rawBody.toString('utf8');
    const valid = input.secrets.some((s) =>
      safeEqualHex(signStubDelivery(s, eventId, body), signature),
    );
    return { valid, eventId: valid ? eventId : null };
  }

  parseEvent(payload: unknown): ParsedChannelEvent {
    const p = payload as {
      type?: unknown;
      externalOrderId?: unknown;
      status?: unknown;
      externalStatus?: unknown;
      order?: CanonicalChannelOrder;
    };
    if (!p || typeof p !== 'object')
      throw new ChannelParseError('body is not an object');
    if (p.type === 'noop') return { kind: 'ignored', reason: 'noop' };
    if (p.type === 'order.new') {
      if (!p.order) throw new ChannelParseError('order.new without order');
      assertCanonicalOrder(p.order);
      return { kind: 'order_new', order: p.order };
    }
    if (p.type === 'order.status') {
      if (typeof p.externalOrderId !== 'string' || !p.externalOrderId)
        throw new ChannelParseError('order.status without externalOrderId');
      if (!STATUSES.includes(p.status as CanonicalOrderStatus))
        throw new ChannelParseError('order.status with unknown status');
      if (p.order) assertCanonicalOrder(p.order);
      return {
        kind: 'order_status',
        externalOrderId: p.externalOrderId,
        status: p.status as CanonicalOrderStatus,
        externalStatus:
          typeof p.externalStatus === 'string'
            ? p.externalStatus
            : String(p.status),
        order: p.order,
      };
    }
    throw new ChannelParseError('unknown event type');
  }

  private record(
    method: string,
    externalOrderId?: string,
    detail?: unknown,
  ): void {
    this.calls.push({ method, externalOrderId, detail });
    if (this.failNext.delete(method)) {
      throw new Error(`stub ${method} failed`);
    }
  }

  testConnection(conn: BoundChannelConnection) {
    this.record('testConnection', undefined, {
      location: conn.externalLocationId,
    });
    return Promise.resolve({
      ok: this.testConnectionOk,
      provesLocation: this.testConnectionOk,
      message: this.testConnectionOk ? 'ok' : 'stub credentials rejected',
    });
  }

  acceptOrder(
    _conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<ProviderCallResult> {
    this.record('acceptOrder', externalOrderId);
    this.statuses.set(externalOrderId, 'accepted');
    return Promise.resolve({ ok: true });
  }

  rejectOrder(
    _conn: BoundChannelConnection,
    externalOrderId: string,
    reason: string,
  ): Promise<ProviderCallResult> {
    this.record('rejectOrder', externalOrderId, { reason });
    this.statuses.set(externalOrderId, 'rejected');
    return Promise.resolve({ ok: true });
  }

  markReady(
    _conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<ProviderCallResult> {
    this.record('markReady', externalOrderId);
    return Promise.resolve({ ok: true });
  }

  setItemAvailability(
    _conn: BoundChannelConnection,
    items: { externalItemId: string; available: boolean }[],
  ): Promise<ProviderCallResult> {
    this.record('setItemAvailability', undefined, items);
    return Promise.resolve({ ok: true });
  }

  fetchOrderStatus(_conn: BoundChannelConnection, externalOrderId: string) {
    this.record('fetchOrderStatus', externalOrderId);
    const status = this.statuses.get(externalOrderId);
    return Promise.resolve(status ? { status, externalStatus: status } : null);
  }

  listOpenOrders(conn: BoundChannelConnection) {
    this.record('listOpenOrders', undefined, {
      location: conn.externalLocationId,
    });
    return Promise.resolve(
      this.openOrders.get(conn.externalLocationId ?? '') ?? [],
    );
  }
}
