import { createHash } from 'crypto';
import {
  ChannelParseError,
  type CanonicalChannelLine,
  type CanonicalChannelOrder,
  type CanonicalOrderStatus,
  type ChannelHandover,
} from '../../channel.types';
import { assertCanonicalOrder } from '../../canonical-order';

// Pure translation of a Deliveroo Order API order object (the webhook's
// `body.order`, and the element of `Get Orders`) into the canonical order.
// Field names and meanings are VERIFIED from the public reference pages
// (order-events-webhook, get-order-v2, 2026-10-21); anything not stated there is
// marked INFERRED. Money is `{fractional, currency_code}` in minor units.

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim().length > 0 ? v : null;

interface Money {
  minor: number;
  currency: string;
}

function money(v: unknown): Money | null {
  if (!isObj(v)) return null;
  const f = v.fractional;
  const c = typeof v.currency_code === 'string' ? v.currency_code.trim() : '';
  if (!Number.isSafeInteger(f) || (f as number) < 0) return null;
  if (!/^[A-Za-z]{3}$/.test(c)) return null;
  return { minor: f as number, currency: c.toUpperCase() };
}

function iso(v: unknown): string | null {
  return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
}

// The id the marketplace holds for the location; the ONLY place the location id
// is read (routing key and nothing else). Webhook shape: body.order.location_id.
export function locationIdOf(payload: unknown): string | null {
  if (!isObj(payload) || !isObj(payload.body) || !isObj(payload.body.order))
    return null;
  const v = payload.body.order.location_id;
  const s =
    typeof v === 'number' && Number.isSafeInteger(v)
      ? String(v)
      : typeof v === 'string'
        ? v
        : null;
  return s !== null && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,190}$/.test(s) ? s : null;
}

export function mapStatus(status: unknown): CanonicalOrderStatus {
  switch (status) {
    case 'placed':
      return 'placed';
    case 'accepted':
    // `confirmed` is the scheduled-order step AFTER acceptance: still accepted.
    case 'confirmed':
      return 'accepted';
    case 'rejected':
      return 'rejected';
    case 'canceled':
      return 'cancelled';
    default:
      // `pending` and anything new: keep the vendor word in externalStatus.
      return 'other';
  }
}

// fulfillment_type (VERIFIED enum). Which party delivers decides order.orderType
// (see the plan, section 5.4). `restaurant` = the merchant's own rider.
// INFERRED: autonomous, table_service, catering have no documented meaning for a
// florist; they map to the two handovers that NEVER reach the driver dispatch
// lists, which is the safe direction.
function handoverOf(t: unknown): ChannelHandover {
  switch (t) {
    case 'restaurant':
      return 'merchant_delivery';
    case 'customer':
    case 'table_service':
      return 'customer_pickup';
    default:
      return 'marketplace_courier';
  }
}

// Acceptance window. VERIFIED (patch-order): "an ASAP order not accepted within
// 10 minutes is rejected automatically; 7 for Kuwait and UAE". There is no
// deadline field in the payload, so it is derived from the placed time. The
// market is the prefix of the order id (`{market}:{uuid}`, VERIFIED format).
// INFERRED: an unknown market uses the shorter window (alerting early is safe).
export function acceptWindowMinutes(orderId: string): number {
  const market = orderId.split(':')[0]?.toUpperCase() ?? '';
  if (market === 'AE' || market === 'KW') return 7;
  return /^[A-Z]{2}$/.test(market) ? 10 : 7;
}

function modifierText(mods: unknown, depth = 0): string[] {
  if (!Array.isArray(mods) || depth > 6) return [];
  const out: string[] = [];
  for (const m of mods) {
    if (!isObj(m)) continue;
    const name = str(m.name);
    const q = Number.isSafeInteger(m.quantity) ? (m.quantity as number) : 1;
    if (name) out.push(q > 1 ? `${name} x${q}` : name);
    out.push(...modifierText(m.modifiers, depth + 1));
  }
  return out;
}

// unit_price + each modifier's unit_price x quantity (nested). Used only to
// cross-check item.total_price (see lineUnitPrice).
function computedUnit(item: Obj, cur: string, depth = 0): number {
  const base = money(item.unit_price);
  let sum = base && base.currency === cur ? base.minor : 0;
  if (Array.isArray(item.modifiers) && depth < 6) {
    for (const m of item.modifiers) {
      if (!isObj(m)) continue;
      const q = Number.isSafeInteger(m.quantity) ? (m.quantity as number) : 1;
      sum += computedUnit(m, cur, depth + 1) * q;
    }
  }
  return sum;
}

// Per-unit price including modifiers, before discount. VERIFIED: item.total_price
// is "price per unit including the item's modifiers, before discounts; multiply
// by quantity" for live orders, but "already the line total, do not multiply" for
// TEST orders (get-order-v2). A quantity above 1 whose total_price equals
// computed-unit x quantity is the test-order shape, so the computed unit price is
// used there. INFERRED: modifier.quantity is per one parent unit.
function lineUnitPrice(item: Obj, qty: number, cur: string): number {
  const computed = computedUnit(item, cur);
  const total = money(item.total_price);
  if (!total || total.currency !== cur) return computed;
  if (qty > 1 && computed > 0 && total.minor === computed * qty)
    return computed;
  return total.minor;
}

// Items without a pos_item_id cannot be mapped by a stable id. INFERRED: a stable
// synthetic id from the item name lets the merchant map it once; it never maps to
// a product by itself, so the order waits in needs_mapping.
function externalItemIdOf(item: Obj): string {
  const id = item.pos_item_id;
  if (typeof id === 'string' && id.trim().length > 0 && id.length <= 191)
    return id;
  if (typeof id === 'number' && Number.isSafeInteger(id)) return String(id);
  const name = (str(item.name) ?? 'unnamed').trim().toLowerCase();
  return `name:${createHash('sha256').update(name).digest('hex').slice(0, 24)}`;
}

function mapLine(item: unknown, cur: string): CanonicalChannelLine {
  if (!isObj(item)) throw new ChannelParseError('an item is not an object');
  const qty = item.quantity;
  if (!Number.isSafeInteger(qty) || (qty as number) < 1)
    throw new ChannelParseError('an item has no valid quantity');
  const notes: string[] = [];
  const mods = modifierText(item.modifiers);
  if (mods.length) notes.push(`+ ${mods.join(', ')}`);
  const vw = item.variable_weight;
  if (isObj(vw) && vw.is_variable_weight === true && isObj(vw.final_weight)) {
    const w = vw.final_weight;
    if (typeof w.value === 'number')
      notes.push(`Weight ${w.value} ${str(w.unit_of_measure) ?? ''}`.trim());
  }
  const disc = money(item.discount_amount);
  return {
    externalItemId: externalItemIdOf(item),
    name: str(item.name) ?? 'Item',
    quantity: qty as number,
    unitPriceMinor: lineUnitPrice(item, qty as number, cur),
    discountMinor: disc && disc.currency === cur ? disc.minor : null,
    // VERIFIED: the order schema carries no tax field.
    taxMinor: null,
    note: notes.length ? notes.join(' | ') : null,
  };
}

export function mapDeliverooOrder(o: unknown): CanonicalChannelOrder {
  if (!isObj(o)) throw new ChannelParseError('order is not an object');
  const id = str(o.id);
  if (!id || id.length > 191) throw new ChannelParseError('order.id missing');

  // Which total is "what the customer paid" is an open question (plan Q5):
  // total_price is "including fees and discounts deducted"; partner_order_total
  // is the total after substitutions. INFERRED: total_price.
  const total = money(o.total_price);
  if (!total) throw new ChannelParseError('order.total_price missing');
  const cur = total.currency;
  const m = (v: unknown): number | null => {
    const x = money(v);
    return x && x.currency === cur ? x.minor : null;
  };

  const log = Array.isArray(o.status_log) ? o.status_log : [];
  const placedAt =
    log
      .filter((e): e is Obj => isObj(e) && e.status === 'placed' && !!iso(e.at))
      .map((e) => e.at as string)
      .sort()[0] ?? null;
  const asap = o.asap !== false;
  const acceptBy =
    asap && placedAt
      ? new Date(
          Date.parse(placedAt) + acceptWindowMinutes(id) * 60_000,
        ).toISOString()
      : null;
  const scheduledFor = asap
    ? null
    : (iso(o.prepare_for) ?? iso(o.start_preparing_at));

  const delivery = isObj(o.delivery) ? o.delivery : null;
  const cust = isObj(o.customer) ? o.customer : null;
  const address = delivery
    ? [delivery.line1, delivery.line2, delivery.city, delivery.postcode]
        .map(str)
        .filter((x): x is string => !!x)
        .join(', ')
    : '';
  const notes = [
    str(o.order_notes),
    delivery ? str(delivery.note) : null,
    isObj(o.remake_details) && str(o.remake_details.parent_order_id)
      ? `Remake of order ${str(o.remake_details.parent_order_id)}`
      : null,
  ].filter((x): x is string => !!x);

  const items = Array.isArray(o.items) ? o.items : [];
  const order: CanonicalChannelOrder = {
    externalOrderId: id,
    displayId: str(o.display_id) ?? str(o.order_number),
    externalStatus: (str(o.status) ?? 'placed').slice(0, 32),
    placedAt,
    acceptBy,
    scheduledFor,
    currency: cur,
    handover: handoverOf(o.fulfillment_type),
    lines: items.map((i) => mapLine(i, cur)),
    totals: {
      subtotalMinor: m(o.subtotal),
      // VERIFIED only for restaurant-fulfilled orders (delivery.delivery_fee).
      deliveryFeeMinor: delivery ? m(delivery.delivery_fee) : null,
      discountMinor: m(o.offer_discount),
      // VERIFIED ABSENT from the order schema: tax and commission stay NULL.
      taxMinor: null,
      commissionMinor: null,
      totalMinor: total.minor,
      cashDueMinor: m(o.cash_due),
    },
    customer: {
      name:
        str(cust?.first_name) ??
        (delivery ? str(delivery.customer_name) : null),
      phone:
        str(cust?.contact_number) ??
        (delivery ? str(delivery.contact_number) : null),
      address: address || null,
      notes: notes.length ? notes.join(' | ') : null,
    },
  };
  assertCanonicalOrder(order);
  return order;
}
