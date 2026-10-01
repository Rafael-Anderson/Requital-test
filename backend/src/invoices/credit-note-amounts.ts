import { roundMoney } from '../common/currency-minor-units';

// The money on a credit note issued for a RETURN. A full credit note needs no
// arithmetic at all: it copies the invoice's own frozen subtotal / tax / total.
//
// Built from the order's CAPTURED per-line tax (orderitem.taxRate/taxAmount, B2),
// pro rata by the returned quantity - never from a live shop rate, for the same
// reason the invoice itself is frozen.
//
// NULL captured tax means UNKNOWN, not zero. A line from an order that predates
// the capture has no tax figure to take a share of, and inventing one (or
// printing 0) would put a made-up number on an accounting document, so this
// throws instead and the caller answers 400.

export class CreditNoteTaxUnknownError extends Error {}

export interface OrderLineForCredit {
  id: number;
  quantity: number;
  priceAtPurchase: string | number;
  taxRate: string | number | null;
  taxAmount: string | number | null;
}

export interface CreditedLine {
  orderItemId: number;
  quantity: number;
  unitPrice: number;
  taxRate: number | null;
  // Already rounded to the currency's minor unit; the credit note's own
  // taxAmount is the sum of these, so the printed column adds up.
  taxAmount: number;
}

export interface ReturnCredit {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  total: number;
  lines: CreditedLine[];
}

export function computeReturnCredit(params: {
  orderLines: OrderLineForCredit[];
  returned: { orderItemId: number; quantity: number }[];
  // order.discountAmount, apportioned by gross value exactly as
  // computeOrderTotals apportioned it when the tax was captured.
  discountAmount: string | number | null;
  taxInclusive: boolean;
  currency: string;
}): ReturnCredit {
  const { orderLines, returned, taxInclusive, currency } = params;
  const byId = new Map(orderLines.map((l) => [l.id, l]));
  const totalGross = orderLines.reduce(
    (sum, l) => sum + Number(l.priceAtPurchase) * l.quantity,
    0,
  );

  let creditedGross = 0;
  const lines: CreditedLine[] = returned.map((r) => {
    const line = byId.get(r.orderItemId);
    if (!line) throw new Error(`order item ${r.orderItemId} not on order`);
    if (line.taxAmount == null) throw new CreditNoteTaxUnknownError();
    const unitPrice = Number(line.priceAtPurchase);
    creditedGross += unitPrice * r.quantity;
    return {
      orderItemId: r.orderItemId,
      quantity: r.quantity,
      unitPrice,
      taxRate: line.taxRate == null ? null : Number(line.taxRate),
      taxAmount: roundMoney(
        (Number(line.taxAmount) * r.quantity) / line.quantity,
        currency,
      ),
    };
  });

  const discount = Math.min(Math.max(Number(params.discountAmount ?? 0), 0), totalGross);
  const subtotal = roundMoney(creditedGross, currency);
  const discountAmount = roundMoney(
    totalGross > 0 ? (discount * creditedGross) / totalGross : 0,
    currency,
  );
  const taxAmount = roundMoney(
    lines.reduce((sum, l) => sum + l.taxAmount, 0),
    currency,
  );
  // Computed from the ROUNDED components so the document's column adds up to the
  // cent. Inclusive prices already contain the tax; exclusive ones owe it on top.
  const total = roundMoney(
    subtotal - discountAmount + (taxInclusive ? 0 : taxAmount),
    currency,
  );
  return { subtotal, discountAmount, taxAmount, total, lines };
}
