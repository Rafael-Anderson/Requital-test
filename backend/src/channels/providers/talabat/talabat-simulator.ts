import { randomUUID } from 'crypto';
import { Injectable } from '@nestjs/common';

// An in-memory FAKE of the Talabat (Delivery Hero) Partner API. It is the ONLY
// transport the Talabat provider has: there is no HTTP client anywhere in this
// folder (talabat.spec.ts scans for one), so nothing in this code base can reach
// Talabat. It models the public documentation recorded in
// docs/plans/marketplace-channels.md, section 3 (VERIFIED) and the owner-supplied
// standards (INFERRED shapes, labelled below). It exists to exercise the whole
// pipeline offline and to be replaced by a real transport only after a signed
// contract, credentials and a sandbox exist (plan section 12).

export class TalabatSimulatorError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

// VERIFIED statuses and reasons (plan section 3).
export const TALABAT_CANCEL_REASONS = [
  'CLOSED',
  'ITEM_UNAVAILABLE',
  'TOO_BUSY',
] as const;
export type TalabatCancelReason = (typeof TALABAT_CANCEL_REASONS)[number];
export const TALABAT_OUTLET_STATUSES = [
  'OPEN',
  'CLOSED_TODAY',
  'CLOSED_UNTIL',
  'CHECKIN',
] as const;

export interface SimAccount {
  clientId: string;
  clientSecret: string;
  chainId: string;
  // VERIFIED prerequisite: credentials come from the Account Manager after a
  // signed contract. A simulated account without one cannot get a token.
  contractSigned: boolean;
  vendorIds: string[];
}

export interface TalabatOrderBody {
  status: string;
  order_id: string;
  delivery_type?: string;
  cart_confirmed?: boolean;
  cancellation?: { reason: string };
  [k: string]: unknown;
}

export interface SimItemSpec {
  sku: string;
  name?: string;
  quantity?: number;
  unitPrice: number | string;
  // Per-unit price before a promotion (original_pricing); omitted = none.
  originalUnitPrice?: number | string;
  // Total discount on the line (all units), only when the payload states it.
  discount?: number | string;
}

export interface SimOrderSpec {
  items: SimItemSpec[];
  currency?: string | null;
  // INFERRED field: PLATFORM_DELIVERY (default) | VENDOR_DELIVERY | PICKUP.
  deliveryType?: string;
  paymentType?: string;
  deliveryFee?: number | string;
  customer?: Record<string, unknown>;
  // Merged over the generated payment block (lets a test omit a field with
  // undefined, e.g. total_taxes).
  payment?: Record<string, unknown>;
  orderId?: string;
}

const TOKEN_TTL_SECONDS = 7200; // VERIFIED: tokens last 2 hours
const RATE_LIMIT_PER_MINUTE = 60; // VERIFIED: GET and PUT together

@Injectable()
export class TalabatSimulator {
  now: () => number = () => Date.now();
  readonly accounts = new Map<string, SimAccount>();
  private readonly tokens = new Map<
    string,
    { chainId: string; expiresAt: number }
  >();
  private readonly orders = new Map<
    string,
    { chainId: string; vendorId: string; body: TalabatOrderBody }
  >();
  private readonly calls = new Map<string, number[]>();
  readonly vendorStatus = new Map<string, Record<string, unknown>>();
  readonly prepTimes = new Map<string, number>();
  readonly catalog = new Map<
    string,
    Map<string, { sku: string; active: boolean; price: number | null }>
  >();
  readonly jobs = new Map<string, 'QUEUED' | 'COMPLETED' | 'FAILED'>();
  // Every request the provider made, for assertions (never holds secrets).
  readonly log: { op: string; chainId?: string; detail?: unknown }[] = [];
  failNext: string | null = null;

  reset(): void {
    this.now = () => Date.now();
    this.accounts.clear();
    this.tokens.clear();
    this.orders.clear();
    this.calls.clear();
    this.vendorStatus.clear();
    this.prepTimes.clear();
    this.catalog.clear();
    this.jobs.clear();
    this.log.length = 0;
    this.failNext = null;
  }

  registerAccount(a: SimAccount): void {
    this.accounts.set(a.clientId, a);
  }

  // POST /v2/oauth/token (VERIFIED path; the HTTP method and grant type are not
  // stated in the docs, so none is modelled).
  token(clientId: string, clientSecret: string) {
    this.log.push({ op: 'token' });
    const a = this.accounts.get(clientId);
    if (!a || a.clientSecret !== clientSecret)
      throw new TalabatSimulatorError(401, 'invalid client credentials');
    if (!a.contractSigned)
      throw new TalabatSimulatorError(403, 'no signed commercial contract');
    const accessToken = randomUUID();
    this.tokens.set(accessToken, {
      chainId: a.chainId,
      expiresAt: this.now() + TOKEN_TTL_SECONDS * 1000,
    });
    return { access_token: accessToken, expires_in: TOKEN_TTL_SECONDS };
  }

  private auth(token: string, chainId: string, op: string): void {
    this.log.push({ op, chainId });
    const t = this.tokens.get(token);
    if (!t || t.expiresAt <= this.now())
      throw new TalabatSimulatorError(401, 'token expired or invalid');
    // One token covers every store in ITS chain, and only that chain.
    if (t.chainId !== chainId)
      throw new TalabatSimulatorError(403, 'chain not allowed');
    const since = this.now() - 60_000;
    const recent = (this.calls.get(chainId) ?? []).filter((x) => x > since);
    if (recent.length >= RATE_LIMIT_PER_MINUTE)
      throw new TalabatSimulatorError(
        429,
        'rate limit: 60 requests per minute',
      );
    recent.push(this.now());
    this.calls.set(chainId, recent);
    if (this.failNext === op) {
      this.failNext = null;
      throw new TalabatSimulatorError(503, 'simulated outage');
    }
  }

  private requireVendor(chainId: string, vendorId: string): void {
    const ok = [...this.accounts.values()].some(
      (a) => a.chainId === chainId && a.vendorIds.includes(vendorId),
    );
    if (!ok) throw new TalabatSimulatorError(404, 'vendor not found');
  }

  // Whether the credentials can see this vendor (used by testConnection).
  vendorVisible(token: string, chainId: string, vendorId: string): boolean {
    this.auth(token, chainId, 'vendor_probe');
    try {
      this.requireVendor(chainId, vendorId);
      return true;
    } catch {
      return false;
    }
  }

  // The "Test Order" button in the Partner Portal: returns the RECEIVED webhook
  // body Talabat would POST to the partner, and holds the order.
  placeOrder(
    chainId: string,
    vendorId: string,
    spec: SimOrderSpec,
  ): TalabatOrderBody {
    const items = spec.items.map((i) => {
      const qty = i.quantity ?? 1;
      const unit = Number(i.unitPrice);
      const original =
        i.originalUnitPrice !== undefined
          ? Number(i.originalUnitPrice)
          : undefined;
      return {
        sku: i.sku,
        barcode: null,
        name: i.name ?? `Item ${i.sku}`,
        status: 'IN_CART',
        pricing: {
          unit_price: i.unitPrice,
          total_price: Number((unit * qty).toFixed(3)),
          quantity: qty,
          vat_percent: 5,
          ...(i.discount !== undefined ? { discount: i.discount } : {}),
        },
        ...(original !== undefined
          ? {
              original_pricing: {
                unit_price: i.originalUnitPrice,
                total_price: Number((original * qty).toFixed(3)),
                quantity: qty,
              },
            }
          : {}),
      };
    });
    const sub = spec.items.reduce(
      (t, i) => t + Number(i.unitPrice) * (i.quantity ?? 1),
      0,
    );
    const fee = Number(spec.deliveryFee ?? 0);
    const orderId = spec.orderId ?? randomUUID();
    const body: TalabatOrderBody = {
      status: 'RECEIVED',
      order_id: orderId,
      external_order_id: `ext-${orderId.slice(0, 8)}`,
      order_code: orderId.slice(0, 4).toUpperCase(),
      client: {
        store_id: vendorId,
        external_partner_config_id: `cfg-${vendorId}`,
        chain_id: chainId,
      },
      currency: spec.currency === undefined ? 'AED' : spec.currency,
      delivery_type: spec.deliveryType ?? 'PLATFORM_DELIVERY',
      items,
      payment: {
        sub_total: Number(sub.toFixed(3)),
        order_total: Number((sub + fee).toFixed(3)),
        delivery_fee: fee,
        type: spec.paymentType ?? 'CARD',
        ...spec.payment,
      },
      customer: {
        name: 'S. K.',
        phone: '+9715XXXXXXX',
        address: 'Marina, Dubai',
        ...spec.customer,
      },
      sys: { created_at: new Date(this.now()).toISOString() },
      isPreorder: false,
    };
    this.orders.set(orderId, { chainId, vendorId, body });
    return structuredClone(body);
  }

  // GET /v2/chains/{chain_id}/orders/{order_id}
  getOrder(token: string, chainId: string, orderId: string): TalabatOrderBody {
    this.auth(token, chainId, 'get_order');
    const o = this.orders.get(orderId);
    if (!o || o.chainId !== chainId)
      throw new TalabatSimulatorError(404, 'order not found');
    return structuredClone(o.body);
  }

  // PUT /v2/chains/{chain_id}/orders/{order_id}. VERIFIED statuses:
  // UPDATE_CART, READY_FOR_PICKUP (platform delivery), DISPATCHED (vendor
  // delivery), cancel with CLOSED | ITEM_UNAVAILABLE | TOO_BUSY.
  putOrder(
    token: string,
    chainId: string,
    orderId: string,
    req: { status: string; reason?: string },
  ): void {
    this.auth(token, chainId, `put_order:${req.status}`);
    const o = this.orders.get(orderId);
    if (!o || o.chainId !== chainId)
      throw new TalabatSimulatorError(404, 'order not found');
    const cur = o.body.status;
    if (cur === 'CANCELLED' || cur === 'DISPATCHED')
      throw new TalabatSimulatorError(409, `order is already ${cur}`);
    switch (req.status) {
      case 'UPDATE_CART':
        o.body.cart_confirmed = true; // INFERRED: how a partner "accepts"
        return;
      case 'READY_FOR_PICKUP':
        if (o.body.delivery_type === 'VENDOR_DELIVERY')
          throw new TalabatSimulatorError(
            400,
            'READY_FOR_PICKUP is for platform delivery',
          );
        o.body.status = 'READY_FOR_PICKUP';
        return;
      case 'DISPATCHED':
        if (o.body.delivery_type !== 'VENDOR_DELIVERY')
          throw new TalabatSimulatorError(
            400,
            'DISPATCHED is for vendor delivery',
          );
        o.body.status = 'DISPATCHED';
        return;
      case 'CANCELLED':
        if (!TALABAT_CANCEL_REASONS.includes(req.reason as TalabatCancelReason))
          throw new TalabatSimulatorError(400, 'unknown cancellation reason');
        o.body.status = 'CANCELLED';
        o.body.cancellation = { reason: req.reason! };
        return;
      default:
        throw new TalabatSimulatorError(400, 'unknown order status');
    }
  }

  // The Talabat side cancels (e.g. the customer): the webhook body to send.
  cancelFromTalabat(orderId: string): TalabatOrderBody {
    const o = this.orders.get(orderId);
    if (!o) throw new Error('unknown simulated order');
    o.body.status = 'CANCELLED';
    o.body.cancellation = { reason: 'CUSTOMER_CANCELLED' };
    return structuredClone(o.body);
  }

  // GET /v2/chains/{chain_id}/vendors/{vendor_id}: VERIFIED as the "webhook is
  // down" fallback. Returns the orders that are not final.
  listVendorOrders(
    token: string,
    chainId: string,
    vendorId: string,
  ): TalabatOrderBody[] {
    this.auth(token, chainId, 'list_vendor_orders');
    this.requireVendor(chainId, vendorId);
    return [...this.orders.values()]
      .filter(
        (o) =>
          o.chainId === chainId &&
          o.vendorId === vendorId &&
          o.body.status !== 'CANCELLED' &&
          o.body.status !== 'DISPATCHED',
      )
      .map((o) => structuredClone(o.body));
  }

  // PUT /v2/chains/{chain_id}/status. VERIFIED values; closed_reason optional.
  putOutletStatus(
    token: string,
    chainId: string,
    req: {
      vendorId: string;
      status: string;
      closedUntil?: string;
      closedReason?: string;
    },
  ): void {
    this.auth(token, chainId, 'put_status');
    this.requireVendor(chainId, req.vendorId);
    if (!(TALABAT_OUTLET_STATUSES as readonly string[]).includes(req.status))
      throw new TalabatSimulatorError(400, 'unknown outlet status');
    if (req.status === 'CLOSED_UNTIL' && !req.closedUntil)
      throw new TalabatSimulatorError(400, 'closed_until is required');
    this.vendorStatus.set(`${chainId}:${req.vendorId}`, { ...req });
  }

  // PUT /v2/chains/{chain_id}/vendors/{vendor_id}/catalog: asynchronous (202 +
  // job_id). Items are identified by `sku`; a push is an upsert by sku, so the
  // ids a partner sends are the ids Talabat keeps (stable ids).
  putCatalog(
    token: string,
    chainId: string,
    vendorId: string,
    products: { sku: string; active?: boolean; price?: number }[],
  ): { job_id: string } {
    this.auth(token, chainId, 'put_catalog');
    this.requireVendor(chainId, vendorId);
    const key = `${chainId}:${vendorId}`;
    const cat =
      this.catalog.get(key) ??
      new Map<string, { sku: string; active: boolean; price: number | null }>();
    for (const p of products) {
      if (typeof p.sku !== 'string' || !p.sku)
        throw new TalabatSimulatorError(400, 'sku is required');
      const prev = cat.get(p.sku) as
        { active: boolean; price: number | null } | undefined;
      if (!prev && typeof p.price !== 'number')
        throw new TalabatSimulatorError(400, 'price is required for a new sku');
      if (p.price !== undefined && !(p.price >= 0))
        throw new TalabatSimulatorError(400, 'price must be >= 0');
      cat.set(p.sku, {
        sku: p.sku,
        active: p.active ?? prev?.active ?? true,
        price: p.price ?? prev?.price ?? null,
      });
    }
    this.catalog.set(key, cat);
    const job = randomUUID();
    this.jobs.set(job, 'QUEUED');
    return { job_id: job };
  }

  // INFERRED (owner-supplied standard "dynamic prep-time adjustment"; the public
  // docs name no endpoint): the simulator accepts a whole number of minutes.
  putPrepTime(
    token: string,
    chainId: string,
    vendorId: string,
    minutes: number,
  ): void {
    this.auth(token, chainId, 'put_prep_time');
    this.requireVendor(chainId, vendorId);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240)
      throw new TalabatSimulatorError(400, 'minutes must be 1 to 240');
    this.prepTimes.set(`${chainId}:${vendorId}`, minutes);
  }
}
