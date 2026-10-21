import {
  ChannelParseError,
  type CanonicalChannelLine,
  type CanonicalChannelOrder,
  type CanonicalOrderStatus,
  type ChannelHandover,
  type ParsedChannelEvent,
} from '../../channel.types';
import { assertCanonicalOrder } from '../../canonical-order';
import { decimalToMinor } from '../../../drivers/cash';

// Talabat partner webhook body -> canonical order. Pure.
//
// VERIFIED field names (plan section 3): order_id, external_order_id,
// order_code, client.store_id, items[].sku/name/pricing/original_pricing,
// payment.sub_total/order_total/delivery_fee/discount/total_taxes/type,
// customer, cancellation, sys, promised_for, isPreorder, status.
// INFERRED (not on a public page): the event is carried in `status`, the exact
// nesting of pricing.discount (taken as the TOTAL discount on the line), a
// top-level `currency`, `delivery_type`, `customer.comment`.
//
// Rules: money is read as an exact decimal string (never a float), a figure the
// payload does not state is NULL (never 0, never derived), commission is always
// NULL (the order payload carries none), and nothing here invents a deadline.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function money(v: unknown, currency: string, field: string): number | null {
  if (v === undefined || v === null || v === '') return null;
  const s = typeof v === 'number' ? String(v) : v;
  const minor = typeof s === 'string' ? decimalToMinor(s, currency) : null;
  if (minor === null) throw new ChannelParseError(`${field} is not an amount`);
  return minor;
}

function text(v: unknown): string | null {
  return typeof v === 'string' && v.length > 0 ? v : null;
}

const STATUS_MAP: Record<string, CanonicalOrderStatus> = {
  RECEIVED: 'placed',
  READY_FOR_PICKUP: 'ready',
  DISPATCHED: 'dispatched',
  CANCELLED: 'cancelled',
};

// INFERRED field. Unknown or absent = the marketplace courier, the safe answer:
// the order then never reaches the driver-dispatch lists.
function handoverOf(v: unknown): ChannelHandover {
  if (v === 'VENDOR_DELIVERY') return 'merchant_delivery';
  if (v === 'PICKUP') return 'customer_pickup';
  return 'marketplace_courier';
}

export function routingKeyOf(body: unknown): string | null {
  if (!isObj(body) || !isObj(body.client)) return null;
  return text(body.client.store_id);
}

function buildOrder(b: Obj): CanonicalChannelOrder {
  const orderId = text(b.order_id);
  if (!orderId) throw new ChannelParseError('order_id is missing');
  const pay = isObj(b.payment) ? b.payment : {};
  // The currency is not in the documented field list; without it no figure can
  // be read correctly, so the delivery is dead-lettered (visible, replayable).
  const currency = text(b.currency) ?? text(pay.currency);
  if (!currency || !/^[A-Z]{3}$/.test(currency))
    throw new ChannelParseError('currency is missing from the order');
  if (!Array.isArray(b.items) || b.items.length === 0)
    throw new ChannelParseError('order has no items');

  const lines: CanonicalChannelLine[] = b.items.map((raw, i) => {
    if (!isObj(raw))
      throw new ChannelParseError(`items[${i}] is not an object`);
    const sku = text(raw.sku);
    if (!sku) throw new ChannelParseError(`items[${i}].sku is missing`);
    const pricing = isObj(raw.pricing) ? raw.pricing : {};
    const original = isObj(raw.original_pricing) ? raw.original_pricing : {};
    const qty = Number(pricing.quantity ?? raw.quantity);
    // Price before a promotion when Talabat states it, else the stated price.
    const unit =
      money(original.unit_price, currency, `items[${i}].original_pricing`) ??
      money(pricing.unit_price, currency, `items[${i}].pricing.unit_price`);
    if (unit === null)
      throw new ChannelParseError(`items[${i}] has no unit price`);
    return {
      externalItemId: sku,
      name: text(raw.name) ?? sku,
      quantity: qty,
      unitPriceMinor: unit,
      // Item-level discount: captured only when stated. NULL = unknown.
      discountMinor: money(
        pricing.discount,
        currency,
        `items[${i}].pricing.discount`,
      ),
      // vat_percent is a rate, not an amount: the line tax stays unknown.
      taxMinor: null,
      note: null,
    };
  });

  const total = money(pay.order_total, currency, 'payment.order_total');
  if (total === null)
    throw new ChannelParseError('payment.order_total is missing');
  const type = typeof pay.type === 'string' ? pay.type : '';
  const customer = isObj(b.customer) ? b.customer : {};
  const sys = isObj(b.sys) ? b.sys : {};
  const placed = text(sys.created_at);
  const promised = text(b.promised_for);

  return {
    externalOrderId: orderId,
    displayId: text(b.order_code),
    externalStatus: (typeof b.status === 'string'
      ? b.status
      : 'RECEIVED'
    ).slice(0, 32),
    placedAt: placed && !Number.isNaN(Date.parse(placed)) ? placed : null,
    // Talabat documents no acceptance deadline. Never invent one: the core's
    // 15-minute stale alert covers an order with none.
    acceptBy: null,
    scheduledFor:
      b.isPreorder === true && promised && !Number.isNaN(Date.parse(promised))
        ? promised
        : null,
    currency,
    handover: handoverOf(b.delivery_type),
    lines,
    totals: {
      subtotalMinor: money(pay.sub_total, currency, 'payment.sub_total'),
      deliveryFeeMinor: money(
        pay.delivery_fee,
        currency,
        'payment.delivery_fee',
      ),
      discountMinor: money(pay.discount, currency, 'payment.discount'),
      taxMinor: money(pay.total_taxes, currency, 'payment.total_taxes'),
      commissionMinor: null,
      totalMinor: total,
      // INFERRED: a cash payment type means the customer owes the whole total.
      cashDueMinor: /cash/i.test(type) ? total : null,
    },
    customer: {
      name: text(customer.name),
      phone: text(customer.phone),
      address: text(customer.address),
      notes: text(customer.comment),
    },
  };
}

export function parseTalabatEvent(payload: unknown): ParsedChannelEvent {
  if (!isObj(payload)) throw new ChannelParseError('body is not an object');
  const status = typeof payload.status === 'string' ? payload.status : '';
  const canonical = STATUS_MAP[status];
  if (!canonical) {
    // Unknown events are kept visible (processed as ignored), never an error:
    // an event we do not model must not count against ingestion success.
    return {
      kind: 'ignored',
      reason: `unmodelled event ${status || '(none)'}`,
    };
  }
  if (canonical === 'placed') {
    const order = buildOrder(payload);
    assertCanonicalOrder(order);
    return { kind: 'order_new', order };
  }
  const orderId = text(payload.order_id);
  if (!orderId) throw new ChannelParseError('order_id is missing');
  // A status event may carry the whole order (lets one that outruns RECEIVED
  // still create it). A body that cannot be read as an order is not an error
  // for a status event: the id and status are all it needs.
  let order: CanonicalChannelOrder | undefined;
  try {
    order = buildOrder(payload);
    assertCanonicalOrder(order);
  } catch {
    order = undefined;
  }
  return {
    kind: 'order_status',
    externalOrderId: orderId,
    status: canonical,
    externalStatus: status,
    order,
  };
}
