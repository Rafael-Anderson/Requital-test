import { minorUnitDecimals } from '../../common/currency-minor-units';
import { decimalToMinor, minorToDecimal } from '../../drivers/cash';

// The currencies a Nomod checkout accepts (Nomod's own list). Anything else is
// refused BEFORE an order is created (see blocked-gateway-currencies.ts).
export const NOMOD_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP', 'SAR'] as const;

export function isNomodCurrency(currency: string | null | undefined): boolean {
  return (
    !!currency &&
    (NOMOD_CURRENCIES as readonly string[]).includes(currency.toUpperCase())
  );
}

// Nomod's reference_id is at most 100 characters and must be unique per account.
export const NOMOD_REFERENCE_MAX = 100;
// Free-text limits are undocumented; stay conservative so a long product name can
// never be the reason a checkout is rejected.
const ITEM_NAME_MAX = 100;

// What the amount reconciliation reads: the ORDER's frozen figures only (the
// order row and its order lines), never today's catalogue or shop settings.
export interface NomodOrderSnapshot {
  currency: string;
  // order.total less nothing: the full total. Gift card and store credit are
  // taken off below, so the amount sent is what is still DUE.
  total: string;
  deliveryFee: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
  giftCardAmount: string | null;
  storeCreditAmount: string | null;
  lines: {
    id: number;
    name: string;
    quantity: number;
    // orderitem.priceAtPurchase: the unit price the customer was charged, already
    // net of any automatic discount, as stored (a decimal string).
    unitPrice: string;
  }[];
}

export interface NomodItem {
  item_id: string;
  name: string;
  quantity: number;
  unit_amount: string;
  discount_type: 'flat';
  discount_amount: string;
  total_amount: string;
  net_amount: string;
}

export interface NomodAmounts {
  currency: string;
  items: NomodItem[];
  // Decimal string, present only when the lines add up to MORE than what is due.
  discount?: string;
  // amount = sum(items.total_amount) - discount, by construction.
  amount: string;
  amountMinor: number;
}

export class NomodAmountError extends Error {}

// price (decimal string, any precision) x quantity, rounded ONCE to the currency's
// minor unit (half up), by exact integer arithmetic: no floating point anywhere.
// A unit price of 10.505 x 3 is 31.515 -> 31.52, not 3 x round(10.505).
export function lineTotalMinor(
  price: string,
  quantity: number,
  currency: string,
): number {
  const m = /^(\d+)(?:\.(\d+))?$/.exec(price.trim());
  if (!m || !Number.isInteger(quantity) || quantity < 1) {
    throw new NomodAmountError('unreadable order line');
  }
  const frac = m[2] ?? '';
  const decimals = minorUnitDecimals(currency);
  const scaled = BigInt(m[1] + frac) * BigInt(quantity); // price * 10^frac.length
  // minor = scaled * 10^decimals / 10^frac.length, rounded half up.
  const num = scaled * 10n ** BigInt(decimals);
  const den = 10n ** BigInt(frac.length);
  const minor = (num + den / 2n) / den;
  if (minor > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new NomodAmountError('order line too large');
  }
  return Number(minor);
}

function minorOf(value: string | null, currency: string): number {
  if (value === null || value === undefined || value === '') return 0;
  const n = decimalToMinor(value, currency);
  if (n === null) throw new NomodAmountError('unreadable order amount');
  return n;
}

// What is still to be paid, in minor units: total - gift card - store credit, never
// below zero (the same definition as common/amount-due.ts, restated here on the
// snapshot so this module has no dependency on a raw order row).
export function snapshotDueMinor(s: NomodOrderSnapshot): number {
  return Math.max(
    minorOf(s.total, s.currency) -
      minorOf(s.giftCardAmount, s.currency) -
      minorOf(s.storeCreditAmount, s.currency),
    0,
  );
}

function clip(name: string, max: number): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  const chars = Array.from(clean);
  return (chars.length > max ? chars.slice(0, max).join('') : clean) || 'Item';
}

// The reconciliation. Nomod computes amount = sum(items) - discount, and wants
// `amount` to equal that. Our order total is built from more than the goods
// (delivery, tax on an exclusive-tax shop, an order-level discount, and tenders
// already taken: gift card, store credit), so the lines are completed instead of
// the total being bent:
//
//   lines     = one item per order line, then Delivery (when charged), then one
//               "Tax" line for whatever the stored total carries above
//               goods + delivery - discount (the tax on an exclusive-tax order, or
//               a one-minor-unit gap between per-line and whole-order rounding)
//   discount  = lines - due, i.e. the order discount plus the gift card and store
//               credit already applied (all of which are money the customer does
//               not owe the gateway)
//   amount    = due = total - gift card - store credit
//
// Everything is integer minor units, so amount == sum(items) - discount holds
// exactly (asserted before returning) and `amount` equals what the order still owes
// to the minor unit. A figure that cannot be parsed, or that would make the
// discount negative, throws instead of producing a mismatched amount.
export function buildNomodAmounts(s: NomodOrderSnapshot): NomodAmounts {
  const currency = s.currency.toUpperCase();
  if (!isNomodCurrency(currency)) {
    throw new NomodAmountError(`${currency} is not supported by Nomod`);
  }
  if (s.lines.length === 0) {
    throw new NomodAmountError('order has no lines');
  }
  const zero = minorToDecimal(0, currency);
  const dec = (minor: number) => minorToDecimal(minor, currency);

  const items: NomodItem[] = [];
  let goodsMinor = 0;
  for (const line of s.lines) {
    const lineMinor = lineTotalMinor(line.unitPrice, line.quantity, currency);
    goodsMinor += lineMinor;
    // unit_amount x quantity must equal total_amount. When the line total does not
    // divide evenly by the quantity (a unit price with sub-minor precision), send
    // it as ONE item carrying the quantity in its name rather than a rounded unit
    // price that would not multiply back.
    const divisible = lineMinor % line.quantity === 0;
    const name = clip(line.name, ITEM_NAME_MAX);
    items.push({
      item_id: `line-${line.id}`,
      name: divisible ? name : clip(`${name} x${line.quantity}`, ITEM_NAME_MAX),
      quantity: divisible ? line.quantity : 1,
      unit_amount: dec(divisible ? lineMinor / line.quantity : lineMinor),
      discount_type: 'flat',
      discount_amount: zero,
      total_amount: dec(lineMinor),
      net_amount: dec(lineMinor),
    });
  }

  const deliveryMinor = Math.max(minorOf(s.deliveryFee, currency), 0);
  if (deliveryMinor > 0) {
    items.push(extraItem('delivery', 'Delivery', deliveryMinor, currency));
  }

  const totalMinor = minorOf(s.total, currency);
  const orderDiscountMinor = Math.min(
    Math.max(minorOf(s.discountAmount, currency), 0),
    goodsMinor,
  );
  // What the stored total carries beyond goods + delivery - discount.
  const remainder =
    totalMinor - (goodsMinor + deliveryMinor - orderDiscountMinor);
  const taxMinor = Math.max(minorOf(s.taxAmount, currency), 0);
  let linesMinor = goodsMinor + deliveryMinor;
  if (remainder > 0) {
    items.push(
      extraItem(
        remainder === taxMinor ? 'tax' : 'adjustment',
        remainder === taxMinor ? 'Tax' : 'Adjustment',
        remainder,
        currency,
      ),
    );
    linesMinor += remainder;
  }

  const dueMinor = snapshotDueMinor({ ...s, currency });
  if (dueMinor <= 0) {
    throw new NomodAmountError('nothing is left to pay on this order');
  }
  const discountMinor = linesMinor - dueMinor;
  if (discountMinor < 0) {
    // The lines would charge LESS than what is due: never send a short amount.
    throw new NomodAmountError('order lines do not cover the amount due');
  }
  // The invariant Nomod checks on its side, restated on ours.
  if (linesMinor - discountMinor !== dueMinor) {
    throw new NomodAmountError('amount does not reconcile');
  }
  return {
    currency,
    items,
    ...(discountMinor > 0 ? { discount: dec(discountMinor) } : {}),
    amount: dec(dueMinor),
    amountMinor: dueMinor,
  };
}

function extraItem(
  id: string,
  name: string,
  minor: number,
  currency: string,
): NomodItem {
  const v = minorToDecimal(minor, currency);
  return {
    item_id: id,
    name,
    quantity: 1,
    unit_amount: v,
    discount_type: 'flat',
    discount_amount: minorToDecimal(0, currency),
    total_amount: v,
    net_amount: v,
  };
}

// Our reference_id: "<orderId>" for the first checkout of an order, then
// "<orderId>-<attempt>". Unique per order and attempt, stable, and well under 100
// characters. The webhook never parses it (the (shopId, referenceId) row decides).
export function nomodReferenceId(orderId: number, attempt: number): string {
  return attempt <= 1 ? String(orderId) : `${orderId}-${attempt}`;
}
