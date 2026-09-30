// The "of which tax" table a VAT invoice needs, grouped by rate.
//
// Built from the CAPTURED per-line figures (orderitem.taxRate/taxAmount, B2) and
// never from a live shop rate: the whole point of the capture is that an issued
// document keeps adding up after the merchant changes their settings. The same
// reason invoice.currency and invoice.taxInclusive are frozen.

export interface TaxBreakdownLineInput {
  priceAtPurchase: string | number;
  quantity: number;
  taxRate: string | number | null;
  taxAmount: string | number | null;
}

export interface TaxBreakdownRow {
  taxRate: number;
  taxableAmount: number;
  taxAmount: number;
  // Set only for the delivery-fee row, which has no product tax class of its own.
  label?: string;
}

// Returns [] when NO line carries the capture - i.e. an order placed before B2.
// Those invoices show the single Tax total and no breakdown, because a breakdown
// derived from today's rates would be a fabrication about a historical sale.
export function buildTaxBreakdown(params: {
  items: TaxBreakdownLineInput[];
  discountAmount: string | number | null;
  taxInclusive: boolean;
  // order.taxAmount. Used only to detect tax that the LINES do not account for,
  // which can only be a taxed delivery fee (shop.taxOnDelivery).
  orderTaxAmount: string | number | null;
}): TaxBreakdownRow[] {
  const { items, taxInclusive } = params;
  const captured = items.filter((i) => i.taxAmount != null);
  if (captured.length === 0) return [];

  const grossOf = (i: TaxBreakdownLineInput) =>
    Number(i.priceAtPurchase) * i.quantity;
  const totalGross = items.reduce((sum, i) => sum + grossOf(i), 0);
  const discount = Math.min(
    Math.max(Number(params.discountAmount ?? 0), 0),
    totalGross,
  );

  const byRate = new Map<number, TaxBreakdownRow>();
  let lineTaxTotal = 0;
  for (const item of captured) {
    const gross = grossOf(item);
    // The same pro-rata apportionment computeOrderTotals applied when the order
    // was created, so the net shown here is the base the tax was charged on.
    const share = totalGross > 0 ? gross / totalGross : 0;
    const net = gross - discount * share;
    const lineTax = Number(item.taxAmount);
    // Inclusive pricing: the charged amount contains the tax, so the taxable
    // base is what is left once it is taken out.
    const taxable = taxInclusive ? net - lineTax : net;
    const rate = item.taxRate == null ? 0 : Number(item.taxRate);
    const row = byRate.get(rate) ?? {
      taxRate: rate,
      taxableAmount: 0,
      taxAmount: 0,
    };
    row.taxableAmount += taxable;
    row.taxAmount += lineTax;
    byRate.set(rate, row);
    lineTaxTotal += lineTax;
  }

  const rows = [...byRate.values()].sort((a, b) => b.taxRate - a.taxRate);

  // Anything the lines do not account for is the delivery fee's own tax
  // (shop.taxOnDelivery). Shown as its own row rather than omitted, so the table
  // still sums to the Tax total on the document - a summary that does not add up
  // is the exact defect B2 fixed one layer up.
  const orderTax = Number(params.orderTaxAmount ?? 0);
  const remainder = orderTax - lineTaxTotal;
  // Half a fils: below that it is float noise from the per-line rounding, not a
  // real delivery charge.
  if (remainder > 0.005) {
    rows.push({
      taxRate: 0,
      taxableAmount: 0,
      taxAmount: remainder,
      label: 'Delivery',
    });
  }
  return rows;
}
