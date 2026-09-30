// Cart/checkout tax quote.
//
// A DISPLAY MIRROR of backend/src/public/order-pricing.ts's computeOrderTotals,
// exactly like lib/auto-discounts.ts mirrors the server's discount math: the
// server is the source of truth and recomputes everything at order creation, and
// this exists so the customer is not asked to commit to a total whose tax line
// reads "before tax". If the two ever disagree, the server is right.
//
// Why per line rather than one shop rate: since Phase 2b a product carries its
// own tax class, so a basket mixing a standard-rated bouquet with a zero-rated
// item owes tax on the first only. Quoting one shop rate over the whole subtotal
// would reintroduce the exact overcharge the server just stopped making.

export interface TaxQuoteLine {
  // Line total as charged: unit price x quantity, pre-order-discount.
  amount: number;
  // The product's own rate, as a percentage. `undefined` means UNKNOWN - a cart
  // saved before this field existed - see quoteCartTax.
  taxRate?: number;
}

export interface CartTaxQuote {
  taxAmount: number;
  // True when at least one line's rate was unknown, so the figure is a best
  // estimate rather than a mirror of what the server will charge. Callers use it
  // to soften the label instead of quietly presenting a guess as fact.
  estimated: boolean;
  // Nothing to show: no line had a known rate and the fallback is 0.
  empty: boolean;
}

export function quoteCartTax(params: {
  lines: TaxQuoteLine[];
  discountAmount?: number;
  taxInclusive: boolean;
  // The shop's standard rate, used only for a line whose own rate is unknown.
  fallbackRate?: number;
}): CartTaxQuote {
  const {
    lines,
    discountAmount = 0,
    taxInclusive,
    fallbackRate = 0,
  } = params;

  const gross = lines.reduce((sum, l) => sum + l.amount, 0);
  const discount = Math.min(Math.max(discountAmount, 0), gross);
  let estimated = false;
  let known = false;

  const taxAmount = lines.reduce((sum, line) => {
    let rate = line.taxRate;
    if (rate === undefined) {
      // A cart persisted in localStorage before per-line rates shipped. The
      // shop's standard rate is the best available estimate (most products sit
      // on the default class), and `estimated` tells the caller to say so.
      rate = fallbackRate;
      estimated = true;
    } else {
      known = true;
    }
    // Same pro-rata apportionment the server applies: an order-level discount
    // reduces the taxable base, and with mixed rates there is no single base.
    const share = gross > 0 ? line.amount / gross : 0;
    const net = line.amount - discount * share;
    const factor = 1 + rate / 100;
    return sum + (taxInclusive ? net - net / factor : net * (rate / 100));
  }, 0);

  return {
    taxAmount,
    estimated,
    // A zero quote on a shop that charges no tax is not worth a row.
    empty: taxAmount === 0 && !known,
  };
}
