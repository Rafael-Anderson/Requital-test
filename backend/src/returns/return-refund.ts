import {
  computeReturnCredit,
  CreditNoteTaxUnknownError,
  type OrderLineForCredit,
} from '../invoices/credit-note-amounts';
import { minorUnitFactor } from '../common/currency-minor-units';

// F7. The DEFAULT refund for a return (staff typed no amount) is the returned
// units' share of what the customer actually paid for the goods: the captured
// line price, net of the order-level discount apportioned pro rata, plus the
// captured line tax when the order is tax-EXCLUSIVE (an inclusive price already
// contains it). It is the credit note's own return computation
// (computeReturnCredit), reused so a refund and its credit note cannot drift.
// The delivery fee is not part of it, as before.

export interface RefundOrder {
  total: string | number;
  deliveryFee: string | number | null;
  discountAmount: string | number | null;
  taxAmount: string | number | null;
}

// The order row records no tax mode and shop.taxInclusive can have been flipped
// since, so read the mode off the order's own captured figures: an inclusive
// total is goods-net + delivery, an exclusive one adds the tax on top. Whichever
// the stored total is closer to wins (a zero-tax order: both agree, so it does
// not matter).
export function orderIsTaxInclusive(
  order: RefundOrder,
  lines: OrderLineForCredit[],
): boolean {
  const gross = lines.reduce(
    (s, l) => s + Number(l.priceAtPurchase) * l.quantity,
    0,
  );
  const net =
    gross - Math.min(Math.max(Number(order.discountAmount ?? 0), 0), gross);
  const inclusiveTotal = net + Number(order.deliveryFee ?? 0);
  const total = Number(order.total);
  return (
    Math.abs(total - inclusiveTotal) <
    Math.abs(total - (inclusiveTotal + Number(order.taxAmount ?? 0)))
  );
}

// Minor units to refund for `returning`, or null when the order has no captured
// tax (orderitem.taxAmount NULL = UNKNOWN, a legacy order): the caller keeps the
// old price x quantity default there rather than invent a figure.
//
// Computed as credit(everything returned so far INCLUDING this return) minus
// credit(everything returned BEFORE it), each rounded once to a minor unit. The
// differences telescope, so however an order is split across partial returns the
// refunds sum EXACTLY to the credit of the whole order: the return that
// completes it carries the rounding remainder, no minor unit is lost or created.
export function defaultReturnRefundMinor(params: {
  order: RefundOrder & { currency: string };
  orderLines: OrderLineForCredit[];
  priorReturned: Map<number, number>;
  returning: { orderItemId: number; quantity: number }[];
}): number | null {
  const { order, orderLines, priorReturned, returning } = params;
  const qtyOf = new Map(orderLines.map((l) => [l.id, l.quantity]));
  const cumulative = new Map<number, number>();
  for (const [id, q] of priorReturned) {
    if (qtyOf.has(id)) cumulative.set(id, Math.min(q, qtyOf.get(id)!));
  }
  const before = new Map(cumulative);
  for (const r of returning) {
    cumulative.set(
      r.orderItemId,
      (cumulative.get(r.orderItemId) ?? 0) + r.quantity,
    );
  }
  const taxInclusive = orderIsTaxInclusive(order, orderLines);
  const factor = minorUnitFactor(order.currency);
  const creditMinor = (m: Map<number, number>) =>
    Math.round(
      computeReturnCredit({
        orderLines,
        returned: [...m]
          .filter(([, quantity]) => quantity > 0)
          .map(([orderItemId, quantity]) => ({ orderItemId, quantity })),
        discountAmount: order.discountAmount,
        taxInclusive,
        currency: order.currency,
      }).total * factor,
    );
  try {
    return Math.max(0, creditMinor(cumulative) - creditMinor(before));
  } catch (e) {
    if (e instanceof CreditNoteTaxUnknownError) return null;
    throw e;
  }
}
