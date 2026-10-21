import { createHash } from 'crypto';
import { Injectable } from '@nestjs/common';
import {
  ChannelParseError,
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
import { hmacSha256Hex, safeEqualHex } from '../../hmac';
import { createLogger } from '../../../common/logging/logger';
import {
  DELIVEROO_SANDBOX,
  DeliverooApiClient,
  DeliverooCallError,
  errorCodeOf,
  resolveCredentials,
  type DeliverooCredentials,
  type DeliverooResponse,
} from './deliveroo-api.client';
import {
  locationIdOf,
  mapDeliverooOrder,
  mapStatus,
} from './deliveroo-order.mapper';

const logger = createLogger('DeliverooChannel');

export const DELIVEROO_PROVIDER = 'deliveroo';

// Webhook headers (VERIFIED, securing-webhooks.md).
const GUID_HEADER = 'x-deliveroo-sequence-guid';
const SIGNATURE_HEADER = 'x-deliveroo-hmac-sha256';
// A header-shaped guid only: it is part of the signed string and is joined to the
// body with a single space, so whitespace in it would let one signed
// (guid, body) pair be presented as a different pair.
const GUID_RE = /^[A-Za-z0-9._:-]{1,128}$/;
const SIGNATURE_RE = /^[0-9a-fA-F]{64}$/;
// Starts alphanumeric so '.' and '..' can never become a path segment.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/;

// Replay window. Deliveroo documents NO timestamp in the signature, so the one
// signed time we have is the newest status_log entry inside the (signed) body.
// A delivery whose newest entry is older than this, or further in the future than
// the skew, is refused. Deliveroo retries for at most 30 minutes (VERIFIED), so
// two hours never rejects a legitimate retry. INFERRED: the exact window.
export const MAX_EVENT_AGE_MS = 2 * 60 * 60_000;
export const MAX_EVENT_FUTURE_MS = 10 * 60_000;

// 5 status updates per minute per order (VERIFIED, patch-order).
const ORDER_PATCH_LIMIT = 5;
const ORDER_PATCH_WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 3;
const MAX_RETRY_WAIT_SECONDS = 10;
const MAX_POLL_PAGES = 3;

const REJECT_REASONS = [
  'closing_early',
  'busy',
  'ingredient_unavailable',
  'other',
] as const;

type Headers = Record<string, string | string[] | undefined>;

function singleHeader(h: Headers, name: string): string | null {
  const v = h[name];
  return typeof v === 'string' && v.length > 0 ? v : null;
}

@Injectable()
export class DeliverooChannelProvider implements ChannelProvider {
  readonly name = DELIVEROO_PROVIDER;
  readonly displayName = 'Deliveroo';
  // The exact keys this provider reads out of `credentials` (the admin draws
  // its form from these).
  readonly credentialFields = [
    { key: 'clientId', label: 'Client ID' },
    { key: 'clientSecret', label: 'Client secret' },
  ];

  // provesLocationOwnership stays FALSE: the credentials are almost certainly
  // integrator-level (one set for every merchant), so "these credentials can see
  // this location" proves nothing about whose location it is. Enabling therefore
  // goes through the platform-staff verification path (plan 5.3 / 10b gate 1).
  readonly capabilities: ChannelCapabilities = {
    ...NO_CAPABILITIES,
    acceptReject: true,
    markReady: true,
    itemAvailability: true,
    catalogueSync: true,
    fetchOrderStatus: true,
    pollOrders: true,
    // The webhook secret is likely one value per integration (INFERRED).
    platformWebhookSecret: true,
    provesLocationOwnership: false,
    // NOT built: removeItem / substituteItems (Picking API only, needs order item
    // ids the Order API webhook does not carry), branchStatus and prepTimeAdjust
    // (Site API, not enabled for the owner).
  };

  readonly api = new DeliverooApiClient();
  // Seams for tests.
  now: () => number = () => Date.now();
  sleep: (ms: number) => Promise<void> = (ms) =>
    new Promise((r) => setTimeout(r, ms));

  private readonly patchLog = new Map<string, number[]>();

  // --- inbound -------------------------------------------------------------

  // The platform secret is one value shared by every merchant of the
  // integration, so in production it is OFF unless explicitly allowed
  // (DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET=1). The core also uses it only for a
  // connection that has no secret of its own.
  platformWebhookSecrets(): string[] {
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.DELIVEROO_ALLOW_PLATFORM_WEBHOOK_SECRET !== '1'
    )
      return [];
    const s = process.env.DELIVEROO_SANDBOX_WEBHOOK_SECRET;
    return s ? [s] : [];
  }

  // Cheap, unauthenticated, and refuses before the core touches the database:
  // both headers must be well formed first. The location id comes from the SAME
  // single path parseEvent trusts nothing else for (body.order.location_id).
  extractRoutingKey(rawBody: Buffer, headers: Headers): string | null {
    const guid = singleHeader(headers, GUID_HEADER);
    const sig = singleHeader(headers, SIGNATURE_HEADER);
    if (!guid || !GUID_RE.test(guid) || !sig || !SIGNATURE_RE.test(sig))
      return null;
    try {
      return locationIdOf(JSON.parse(rawBody.toString('utf8')));
    } catch {
      return null;
    }
  }

  // HMAC-SHA256 (hex) keyed by the webhook secret over `<guid> + " " + <raw
  // body bytes>` (single space for this webhook, VERIFIED). The raw Buffer is
  // used, never re-serialised JSON. Every candidate secret is compared (no early
  // exit) in constant time.
  verifyWebhook(input: VerifyWebhookInput): VerifyWebhookResult {
    const bad: VerifyWebhookResult = { valid: false, eventId: null };
    const guid = singleHeader(input.headers, GUID_HEADER);
    const sig = singleHeader(input.headers, SIGNATURE_HEADER);
    if (!guid || !GUID_RE.test(guid) || !sig || !SIGNATURE_RE.test(sig))
      return bad;
    const signed = Buffer.concat([
      Buffer.from(guid, 'utf8'),
      Buffer.from(' ', 'utf8'),
      input.rawBody,
    ]);
    let ok = false;
    for (const secret of input.secrets) {
      if (!secret) continue;
      if (safeEqualHex(hmacSha256Hex(secret, signed), sig)) ok = true;
    }
    if (!ok) return bad;
    if (this.isStale(input.rawBody)) return bad;
    // The delivery id includes a hash of the body: it is not documented whether
    // the sequence guid is unique per delivery, and a guid shared by two
    // different events must never make the second look like a duplicate.
    const bodyHash = createHash('sha256')
      .update(input.rawBody)
      .digest('hex')
      .slice(0, 32);
    return { valid: true, eventId: `${guid}:${bodyHash}` };
  }

  // True = refuse. After a valid HMAC, the body must carry a parseable
  // status_log (every real order has one, VERIFIED) whose newest entry is inside
  // the replay window.
  private isStale(rawBody: Buffer): boolean {
    try {
      const p = JSON.parse(rawBody.toString('utf8')) as {
        body?: { order?: { status_log?: { at?: unknown }[] } };
      };
      const log = p.body?.order?.status_log;
      if (!Array.isArray(log)) return true;
      const times = log
        .map((e) => (typeof e?.at === 'string' ? Date.parse(e.at) : NaN))
        .filter((t) => !Number.isNaN(t));
      if (times.length === 0) return true;
      const newest = Math.max(...times);
      const now = this.now();
      return (
        now - newest > MAX_EVENT_AGE_MS || newest - now > MAX_EVENT_FUTURE_MS
      );
    } catch {
      return true;
    }
  }

  parseEvent(payload: unknown): ParsedChannelEvent {
    const p = payload as {
      event?: unknown;
      body?: { order?: unknown };
    } | null;
    if (!p || typeof p !== 'object')
      throw new ChannelParseError('body is not an object');
    if (p.event !== 'order.new' && p.event !== 'order.status_update') {
      return { kind: 'ignored', reason: 'unsupported event' };
    }
    const raw = p.body?.order;
    if (!raw || typeof raw !== 'object')
      throw new ChannelParseError('event has no order');
    const rawOrder = raw as { id?: unknown; status?: unknown };

    if (p.event === 'order.new') {
      const order = mapDeliverooOrder(raw);
      // The tablet flow can deliver order.new already accepted (VERIFIED: "placed
      // or accepted"): create the order, then confirm it.
      const status = mapStatus(rawOrder.status);
      if (status === 'placed' || status === 'other') {
        return { kind: 'order_new', order };
      }
      return {
        kind: 'order_status',
        externalOrderId: order.externalOrderId,
        status,
        externalStatus: order.externalStatus,
        order,
      };
    }

    if (typeof rawOrder.id !== 'string' || !ID_RE.test(rawOrder.id))
      throw new ChannelParseError('status event has no order id');
    const status = mapStatus(rawOrder.status);
    const externalStatus =
      typeof rawOrder.status === 'string' && rawOrder.status
        ? rawOrder.status.slice(0, 32)
        : status;
    // The whole order rides along so a status event that beats order.new can
    // still create the order. A body that does not map (for example an empty
    // item list on a cancellation) must NOT stop the status itself from being
    // applied, so the order is attached only when it maps.
    let order;
    try {
      order = mapDeliverooOrder(raw);
    } catch {
      order = undefined;
    }
    return {
      kind: 'order_status',
      externalOrderId: rawOrder.id,
      status,
      externalStatus,
      order,
    };
  }

  // --- outbound ------------------------------------------------------------

  private creds(conn: BoundChannelConnection): DeliverooCredentials {
    const c = resolveCredentials(conn.credentials);
    if (!c)
      throw new DeliverooCallError(
        'Deliveroo needs both a Client ID and a Client secret',
      );
    return c;
  }

  private checkId(id: string): string {
    if (!ID_RE.test(id)) throw new DeliverooCallError('Invalid id');
    return id;
  }

  private fail(res: DeliverooResponse): ProviderCallResult {
    const code = errorCodeOf(res.json);
    return {
      ok: false,
      message: `Deliveroo answered ${res.status}${code ? ` (${code})` : ''}`,
    };
  }

  async testConnection(conn: BoundChannelConnection) {
    const no = (message: string) => ({
      ok: false,
      provesLocation: false,
      message,
    });
    let creds: DeliverooCredentials;
    try {
      creds = this.creds(conn);
      await this.api.token(creds);
    } catch (e) {
      return no(e instanceof DeliverooCallError ? e.message : 'Test failed');
    }
    // With a brand id, also check the credentials can list this location's live
    // orders. That shows the credentials work for the location; it does NOT show
    // the location is the merchant's (integrator-level credentials), hence
    // provesLocation is always false.
    if (conn.externalBrandId && conn.externalLocationId) {
      try {
        const res = await this.api.request(
          creds,
          'GET',
          this.ordersListUrl(conn, true),
        );
        if (res.status >= 400) return no(this.fail(res).message!);
      } catch (e) {
        return no(e instanceof DeliverooCallError ? e.message : 'Test failed');
      }
    }
    return { ok: true, provesLocation: false, message: 'ok' };
  }

  // Rate limit 5 per minute per order (VERIFIED). Counted in this process only.
  private allowPatch(orderId: string): boolean {
    const now = this.now();
    const log = (this.patchLog.get(orderId) ?? []).filter(
      (t) => now - t < ORDER_PATCH_WINDOW_MS,
    );
    if (log.length >= ORDER_PATCH_LIMIT) {
      this.patchLog.set(orderId, log);
      return false;
    }
    log.push(now);
    this.patchLog.set(orderId, log);
    if (this.patchLog.size > 2000) {
      for (const [k, v] of this.patchLog) {
        if (v.every((t) => now - t >= ORDER_PATCH_WINDOW_MS))
          this.patchLog.delete(k);
      }
    }
    return true;
  }

  // PATCH /v1/orders/{id}. 204 success; 409 invalid_status_transition is
  // success when the order is already in a state that satisfies the request;
  // 503 order_not_ready is retried after Retry-After (VERIFIED, patch-order).
  private async patchStatus(
    conn: BoundChannelConnection,
    externalOrderId: string,
    body: Record<string, unknown>,
    satisfied: string[],
  ): Promise<ProviderCallResult> {
    try {
      const creds = this.creds(conn);
      const id = this.checkId(externalOrderId);
      const url = `${DELIVEROO_SANDBOX.orderBase}/v1/orders/${id}`;
      for (let attempt = 1; ; attempt++) {
        if (!this.allowPatch(id)) {
          return {
            ok: false,
            message:
              'Deliveroo allows 5 updates a minute per order; try again shortly',
          };
        }
        const res = await this.api.request(creds, 'PATCH', url, body);
        if (res.status === 204 || res.status === 200) return { ok: true };
        if (res.status === 409) {
          const now = await this.fetchOrderStatus(conn, id);
          if (now && satisfied.includes(now.externalStatus))
            return { ok: true };
          return {
            ok: false,
            message: `The order is already ${now?.externalStatus ?? 'in another state'} at Deliveroo`,
          };
        }
        if (
          res.status === 503 &&
          errorCodeOf(res.json) === 'order_not_ready' &&
          attempt < MAX_ATTEMPTS
        ) {
          const wait = Math.min(
            res.retryAfterSeconds ?? 2,
            MAX_RETRY_WAIT_SECONDS,
          );
          await this.sleep(wait * 1000);
          continue;
        }
        return this.fail(res);
      }
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof DeliverooCallError ? e.message : 'Deliveroo call failed',
      };
    }
  }

  acceptOrder(conn: BoundChannelConnection, externalOrderId: string) {
    return this.patchStatus(conn, externalOrderId, { status: 'accepted' }, [
      'accepted',
      'confirmed',
    ]);
  }

  rejectOrder(
    conn: BoundChannelConnection,
    externalOrderId: string,
    reason: string,
  ) {
    const wanted = reason.trim().toLowerCase();
    const known = (REJECT_REASONS as readonly string[]).includes(wanted);
    return this.patchStatus(
      conn,
      externalOrderId,
      {
        status: 'rejected',
        reject_reason: known ? wanted : 'other',
        // Free text only for the catch-all reason, capped.
        ...(known ? {} : { notes: reason.trim().slice(0, 200) }),
      },
      ['rejected', 'canceled'],
    );
  }

  // GET /v2/orders/{id} (1 request per second per order, VERIFIED).
  async fetchOrderStatus(
    conn: BoundChannelConnection,
    externalOrderId: string,
  ): Promise<{ status: CanonicalOrderStatus; externalStatus: string } | null> {
    const creds = this.creds(conn);
    const id = this.checkId(externalOrderId);
    const res = await this.api.request(
      creds,
      'GET',
      `${DELIVEROO_SANDBOX.orderBase}/v2/orders/${id}`,
    );
    if (res.status === 404) return null;
    if (res.status !== 200)
      throw new DeliverooCallError(this.fail(res).message!);
    const s = (res.json as { status?: unknown } | null)?.status;
    if (typeof s !== 'string') return null;
    return { status: mapStatus(s), externalStatus: s.slice(0, 32) };
  }

  // POST /v1/orders/:id/prep_stage {stage, occurred_at}. VERIFIED: path and body.
  // INFERRED: it is served from the same order server. A HUMAN action only: the
  // docs say the ready signal must not be triggered automatically, and nothing in
  // this codebase calls it.
  async markReady(conn: BoundChannelConnection, externalOrderId: string) {
    try {
      const res = await this.api.request(
        this.creds(conn),
        'POST',
        `${DELIVEROO_SANDBOX.orderBase}/v1/orders/${this.checkId(externalOrderId)}/prep_stage`,
        {
          stage: 'ready_for_collection',
          occurred_at: new Date(this.now()).toISOString(),
        },
      );
      return res.status >= 200 && res.status < 300
        ? { ok: true }
        : this.fail(res);
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof DeliverooCallError ? e.message : 'Deliveroo call failed',
      };
    }
  }

  // The menu id is ours and must stay the same ("changing the menu id creates a
  // completely new resource", VERIFIED).
  private menuId(conn: BoundChannelConnection): string {
    return `requital-c${conn.id}`;
  }

  private brandSite(conn: BoundChannelConnection) {
    if (!conn.externalBrandId || !conn.externalSiteId)
      throw new DeliverooCallError('The brand id and site id are required');
    return {
      brand: this.checkId(conn.externalBrandId),
      site: this.checkId(conn.externalSiteId),
    };
  }

  // POST .../menu/v1/brands/{brand}/menus/{menu}/item_unavailabilities/{site}
  // (VERIFIED, update individual item unavailability). One unknown item id fails
  // the whole call with 404 (VERIFIED).
  async setItemAvailability(
    conn: BoundChannelConnection,
    items: { externalItemId: string; available: boolean }[],
  ) {
    try {
      const { brand, site } = this.brandSite(conn);
      const res = await this.api.request(
        this.creds(conn),
        'POST',
        `${DELIVEROO_SANDBOX.menuBase}/v1/brands/${brand}/menus/${this.menuId(conn)}/item_unavailabilities/${site}`,
        {
          item_unavailabilities: items.map((i) => ({
            item_id: i.externalItemId,
            status: i.available ? 'available' : 'unavailable',
          })),
        },
      );
      return res.status === 200 ? { ok: true } : this.fail(res);
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof DeliverooCallError ? e.message : 'Deliveroo call failed',
      };
    }
  }

  // PUT .../menu/v1/brands/{brand}/menus/{menu} (VERIFIED path; body required:
  // menu{mealtimes, categories, items}, site_ids; item required: id, price_info
  // {price in minor units}). INFERRED and unverified against the live sandbox:
  // an empty `mealtimes` is accepted, and `tax_rate` (documented as required for
  // normal items) is OMITTED because the tax rate must never be invented, so
  // Deliveroo may refuse the push until that is settled (plan Q5). `plu` carries
  // the same id so a POS-linked site can match it. The item id is the id the
  // mapping table keys on and never changes.
  async pushCatalogue(
    conn: BoundChannelConnection,
    items: {
      externalItemId: string;
      name: string;
      priceMinor: number;
      currency: string;
      available: boolean;
    }[],
  ) {
    try {
      const { brand, site } = this.brandSite(conn);
      if (items.length < 1 || items.length > 5000)
        return { ok: false, message: 'A menu needs 1 to 5000 items' };
      const res = await this.api.request(
        this.creds(conn),
        'PUT',
        `${DELIVEROO_SANDBOX.menuBase}/v1/brands/${brand}/menus/${this.menuId(conn)}`,
        {
          menu: {
            mealtimes: [],
            categories: [
              {
                id: 'all',
                name: { en: 'Catalogue' },
                item_ids: items.map((i) => i.externalItemId),
              },
            ],
            items: items.map((i) => ({
              id: i.externalItemId,
              plu: i.externalItemId,
              type: 'ITEM',
              name: { en: i.name.slice(0, 120) },
              price_info: { price: i.priceMinor },
            })),
          },
          site_ids: [site],
        },
      );
      return res.status === 200 ? { ok: true } : this.fail(res);
    } catch (e) {
      return {
        ok: false,
        message:
          e instanceof DeliverooCallError ? e.message : 'Deliveroo call failed',
      };
    }
  }

  // --- polling fallback ------------------------------------------------------

  // GET /v2/brand/{brand}/restaurant/{restaurant}/orders?live_orders=true
  // (VERIFIED path and params, 5 requests per minute per restaurant, up to 100
  // orders a page with a `next` cursor). INFERRED: `restaurant_id` is the
  // order's `location_id`. Needs the brand id (a per-connection field).
  private ordersListUrl(
    conn: BoundChannelConnection,
    live: boolean,
    cursor?: string,
  ): string {
    const brand = this.checkId(conn.externalBrandId ?? '');
    const loc = this.checkId(conn.externalLocationId ?? '');
    const q = new URLSearchParams();
    if (live) q.set('live_orders', 'true');
    if (cursor) q.set('cursor', cursor);
    const qs = q.toString();
    return `${DELIVEROO_SANDBOX.orderBase}/v2/brand/${brand}/restaurant/${loc}/orders${qs ? `?${qs}` : ''}`;
  }

  // Each open order becomes one event whose id is DETERMINISTIC (order id plus
  // status), so a repeated poll can never create new inbox rows. A placed order is
  // shaped as order.new; any other status as order.status_update, which carries the
  // whole order and so creates it if the webhook never arrived. An order whose
  // location id differs from the connection's is dropped and logged: it would be a
  // routing bug (or a wrong restaurant_id assumption), never to be ingested.
  async listOpenOrders(conn: BoundChannelConnection) {
    if (!conn.externalBrandId)
      throw new DeliverooCallError('Polling needs the brand id');
    const creds = this.creds(conn);
    const out: { eventId: string; payload: unknown }[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < MAX_POLL_PAGES; page++) {
      const res = await this.api.request(
        creds,
        'GET',
        this.ordersListUrl(conn, true, cursor),
      );
      if (res.status !== 200)
        throw new DeliverooCallError(this.fail(res).message!);
      const j = res.json as { orders?: unknown; next?: unknown } | null;
      for (const o of Array.isArray(j?.orders) ? (j.orders as unknown[]) : []) {
        const order = o as { id?: unknown; status?: unknown };
        if (typeof order?.id !== 'string' || !ID_RE.test(order.id)) continue;
        const payload = {
          event:
            order.status === 'placed' ? 'order.new' : 'order.status_update',
          body: { order: o },
        };
        if (locationIdOf(payload) !== conn.externalLocationId) {
          logger.warn('polled order has a different location id; dropped', {
            connectionId: conn.id,
            shopId: conn.shopId,
          });
          continue;
        }
        out.push({
          eventId:
            `poll:${order.id}:${String(order.status).slice(0, 32)}`.slice(
              0,
              191,
            ),
          payload,
        });
      }
      cursor =
        typeof j?.next === 'string' && j.next.length <= 2000
          ? j.next
          : undefined;
      if (!cursor) break;
    }
    return out;
  }
}
