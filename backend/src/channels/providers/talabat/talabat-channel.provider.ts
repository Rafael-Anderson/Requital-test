import { createHash, timingSafeEqual } from 'crypto';
import { Injectable } from '@nestjs/common';
import { minorUnitFactor } from '../../../common/currency-minor-units';
import {
  NO_CAPABILITIES,
  type BoundChannelConnection,
  type CanonicalOrderStatus,
  type ChannelCapabilities,
  type ChannelProvider,
  type ParsedChannelEvent,
  type ProviderCallResult,
  type VerifyWebhookInput,
  type VerifyWebhookResult,
} from '../../channel.types';
import {
  TALABAT_CANCEL_REASONS,
  TalabatSimulator,
  TalabatSimulatorError,
  type TalabatCancelReason,
} from './talabat-simulator';
import { parseTalabatEvent, routingKeyOf } from './talabat-payload';

// Talabat behind a simulator, and nothing else. There is NO real transport: the
// only thing this provider can talk to is TalabatSimulator, and a connection whose
// credentials name any other endpoint is refused before a single call is made.
// Real Talabat needs a signed contract, credentials, a sandbox and a webhook
// specification, none of which exist (docs/plans/marketplace-channels.md,
// section 12). Registered only where the stub channel is (ChannelsModule).
export const TALABAT_PROVIDER = 'talabat';
export const SIMULATOR_ENDPOINT = 'simulator';

const SAFE = (e: unknown): ProviderCallResult => ({
  ok: false,
  message:
    e instanceof TalabatSimulatorError
      ? `Talabat answered ${e.status}: ${e.message}`
      : 'The marketplace call failed',
});

// Constant time without leaking the secret's length: compare fixed-size digests.
function sameSecret(a: string, b: string): boolean {
  const d = (s: string) => createHash('sha256').update(s).digest();
  return timingSafeEqual(d(a), d(b));
}

// A token belongs to the credentials that minted it, not to a connection row:
// changed credentials can never reuse an old token.
function tokenKey(c: Creds): string {
  return createHash('sha256')
    .update(`${c.clientId}\0${c.clientSecret}\0${c.chainId}`)
    .digest('hex');
}

// The inbox keeps 191 characters of an event id: hash a long order id so the
// status suffix is never the part that gets cut.
export function pollEventId(orderId: string, status: string): string {
  const id =
    orderId.length > 100
      ? createHash('sha256').update(orderId).digest('hex')
      : orderId;
  return `poll:${id}:${status}`;
}

interface Creds {
  clientId: string;
  clientSecret: string;
  chainId: string;
}

@Injectable()
export class TalabatChannelProvider implements ChannelProvider {
  readonly name = TALABAT_PROVIDER;
  // Never provesLocationOwnership: one token covers EVERY store of a chain
  // (VERIFIED), so "these credentials see this store" says nothing about who the
  // store belongs to. Requital staff verify the store id with Talabat instead.
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    // INFERRED: Talabat documents no distinct "accept" call; the simulator
    // models it as confirming the cart (UPDATE_CART), and rejecting as a cancel.
    acceptReject: true,
    markReady: true,
    itemAvailability: true,
    branchStatus: true,
    catalogueSync: true,
    prepTimeAdjust: true,
    fetchOrderStatus: true,
    pollOrders: true,
  };

  private readonly tokens = new Map<
    string,
    { token: string; expiresAt: number }
  >();

  constructor(private readonly sim: TalabatSimulator) {}

  // ---- inbound ------------------------------------------------------------
  extractRoutingKey(rawBody: Buffer): string | null {
    try {
      return routingKeyOf(JSON.parse(rawBody.toString('utf8')));
    } catch {
      return null;
    }
  }

  // The webhook secret is a shared string or a Basic auth value, sent with the
  // request (VERIFIED: not an HMAC). INFERRED: it arrives in `Authorization`.
  // Delivery ids are undocumented, so none is returned and the core falls back
  // to the body hash (the retries of one delivery are identical bytes).
  verifyWebhook(input: VerifyWebhookInput): VerifyWebhookResult {
    const h = input.headers.authorization;
    const sent = Array.isArray(h) ? h[0] : h;
    const valid =
      typeof sent === 'string' &&
      sent.length > 0 &&
      input.secrets.some(
        (s) =>
          s.length > 0 &&
          (sameSecret(sent, s) || sameSecret(sent, `Basic ${s}`)),
      );
    return { valid, eventId: null };
  }

  parseEvent(payload: unknown): ParsedChannelEvent {
    return parseTalabatEvent(payload);
  }

  // ---- outbound -----------------------------------------------------------
  // Parses and checks the credentials. Refuses anything but the simulator.
  private creds(conn: BoundChannelConnection): Creds | ProviderCallResult {
    const c = conn.credentials ?? {};
    if (c.apiBase !== undefined && c.apiBase !== SIMULATOR_ENDPOINT) {
      return {
        ok: false,
        message:
          'Only the local simulator is available. A real Talabat endpoint is not supported.',
      };
    }
    if (!c.clientId || !c.clientSecret || !c.chainId) {
      return {
        ok: false,
        message: 'clientId, clientSecret and chainId are required',
      };
    }
    return {
      clientId: c.clientId,
      clientSecret: c.clientSecret,
      chainId: c.chainId,
    };
  }

  private token(conn: BoundChannelConnection, c: Creds): string {
    const key = tokenKey(c);
    const hit = this.tokens.get(key);
    if (hit && hit.expiresAt > this.sim.now()) return hit.token;
    const t = this.sim.token(c.clientId, c.clientSecret);
    // Refresh five minutes early.
    this.tokens.set(key, {
      token: t.access_token,
      expiresAt: this.sim.now() + (t.expires_in - 300) * 1000,
    });
    return t.access_token;
  }

  private async run(
    conn: BoundChannelConnection,
    fn: (
      token: string,
      chainId: string,
      vendorId: string,
    ) => ProviderCallResult | Promise<ProviderCallResult>,
  ): Promise<ProviderCallResult> {
    const c = this.creds(conn);
    if ('ok' in c) return c;
    if (!conn.externalLocationId)
      return { ok: false, message: 'The store id is not set' };
    try {
      return await fn(this.token(conn, c), c.chainId, conn.externalLocationId);
    } catch (e) {
      // A rejected token must not stick.
      if (e instanceof TalabatSimulatorError && e.status === 401)
        this.tokens.delete(tokenKey(c));
      return SAFE(e);
    }
  }

  testConnection(conn: BoundChannelConnection) {
    return this.run(conn, (token, chainId, vendor) => {
      const seen = this.sim.vendorVisible(token, chainId, vendor);
      return seen
        ? { ok: true }
        : { ok: false, message: 'The store is not part of this chain' };
    }).then((r) => ({ ...r, provesLocation: false }));
  }

  acceptOrder(conn: BoundChannelConnection, externalOrderId: string) {
    return this.run(conn, (t, chain) => {
      this.sim.putOrder(t, chain, externalOrderId, { status: 'UPDATE_CART' });
      return { ok: true };
    });
  }

  rejectOrder(
    conn: BoundChannelConnection,
    externalOrderId: string,
    reason: string,
  ) {
    const r: TalabatCancelReason = /busy/i.test(reason)
      ? 'TOO_BUSY'
      : /item|stock|unavail/i.test(reason)
        ? 'ITEM_UNAVAILABLE'
        : TALABAT_CANCEL_REASONS[0];
    return this.run(conn, (t, chain) => {
      this.sim.putOrder(t, chain, externalOrderId, {
        status: 'CANCELLED',
        reason: r,
      });
      return { ok: true };
    });
  }

  // "Food is ready": READY_FOR_PICKUP for platform delivery, DISPATCHED for a
  // vendor delivery (VERIFIED). Must be a person's action, never automatic.
  markReady(conn: BoundChannelConnection, externalOrderId: string) {
    return this.run(conn, (t, chain) => {
      const o = this.sim.getOrder(t, chain, externalOrderId);
      this.sim.putOrder(t, chain, externalOrderId, {
        status:
          o.delivery_type === 'VENDOR_DELIVERY'
            ? 'DISPATCHED'
            : 'READY_FOR_PICKUP',
      });
      return { ok: true };
    });
  }

  setItemAvailability(
    conn: BoundChannelConnection,
    items: { externalItemId: string; available: boolean }[],
  ) {
    return this.run(conn, (t, chain, vendor) => {
      const { job_id } = this.sim.putCatalog(
        t,
        chain,
        vendor,
        items.map((i) => ({ sku: i.externalItemId, active: i.available })),
      );
      return { ok: true, message: `queued ${job_id}` };
    });
  }

  setBranchStatus(
    conn: BoundChannelConnection,
    status: 'open' | 'closed' | 'busy',
    until?: Date,
  ) {
    return this.run(conn, (t, chain, vendor) => {
      this.sim.putOutletStatus(t, chain, {
        vendorId: vendor,
        status:
          status === 'open' ? 'OPEN' : until ? 'CLOSED_UNTIL' : 'CLOSED_TODAY',
        closedUntil: until?.toISOString(),
        closedReason:
          status === 'busy'
            ? 'TOO_BUSY_KITCHEN'
            : status === 'closed'
              ? 'CLOSED'
              : undefined,
      });
      return { ok: true };
    });
  }

  // The item id is the mapping's own external id: the SAME product always goes
  // out under the SAME sku, whatever its name or price is today.
  pushCatalogue(
    conn: BoundChannelConnection,
    items: {
      externalItemId: string;
      name: string;
      priceMinor: number;
      currency: string;
      available: boolean;
    }[],
  ) {
    return this.run(conn, (t, chain, vendor) => {
      const { job_id } = this.sim.putCatalog(
        t,
        chain,
        vendor,
        items.map((i) => ({
          sku: i.externalItemId,
          active: i.available,
          price: i.priceMinor / minorUnitFactor(i.currency),
        })),
      );
      return { ok: true, message: `queued ${job_id}` };
    });
  }

  adjustPrepTime(conn: BoundChannelConnection, minutes: number) {
    return this.run(conn, (t, chain, vendor) => {
      this.sim.putPrepTime(t, chain, vendor, minutes);
      return { ok: true };
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- the simulator is synchronous; a real transport would await
  async fetchOrderStatus(
    conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<{ status: CanonicalOrderStatus; externalStatus: string } | null> {
    const c = this.creds(conn);
    if ('ok' in c) return null;
    try {
      const o = this.sim.getOrder(
        this.token(conn, c),
        c.chainId,
        externalOrderId,
      );
      const map: Record<string, CanonicalOrderStatus> = {
        RECEIVED: o.cart_confirmed ? 'accepted' : 'placed',
        READY_FOR_PICKUP: 'ready',
        DISPATCHED: 'dispatched',
        CANCELLED: 'cancelled',
      };
      return { status: map[o.status] ?? 'other', externalStatus: o.status };
    } catch (e) {
      if (e instanceof TalabatSimulatorError && e.status === 404) return null;
      throw e;
    }
  }

  // Polling fallback. The event id is stable per order and status, so a repeated
  // poll is a duplicate inbox row, not a new one.
  // eslint-disable-next-line @typescript-eslint/require-await -- the simulator is synchronous; a real transport would await
  async listOpenOrders(conn: BoundChannelConnection) {
    const c = this.creds(conn);
    if ('ok' in c) throw new Error(c.message);
    if (!conn.externalLocationId) return [];
    const orders = this.sim.listVendorOrders(
      this.token(conn, c),
      c.chainId,
      conn.externalLocationId,
    );
    return orders.map((payload) => ({
      eventId: pollEventId(payload.order_id, payload.status),
      payload,
    }));
  }
}
