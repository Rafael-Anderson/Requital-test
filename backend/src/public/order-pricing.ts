// A line as handed to the tax computation: its money amount as charged, and the
// rate its own tax class carries. `taxRate` is a percentage.
//
// `amount` is the line total (unit price x quantity) BEFORE any order-level
// discount — the discount is apportioned across lines here so that one
// apportionment rule exists rather than one per call site.
export interface TaxableLine {
  amount: number;
  taxRate: number;
  // Carried through untouched so the caller can persist the capture without
  // re-deriving which class it resolved. NULL means the line had no class of its
  // own and fell back to the shop default.
  taxClassId: number | null;
}

export interface ComputedLineTax {
  taxClassId: number | null;
  taxRate: number;
  // The line's share of the discounted subtotal, on a TAX-EXCLUSIVE basis. On an
  // inclusive shop this is less than the amount charged, because the charged
  // amount contains the tax.
  taxableAmount: number;
  taxAmount: number;
}

export interface OrderTotals {
  // What goes in `order.taxAmount`: every line's tax plus the delivery fee's,
  // when the shop taxes delivery.
  taxAmount: number;
  total: number;
  // Per line, in the same order the lines came in, for the orderitem capture.
  lines: ComputedLineTax[];
  // Grouped by rate, for a VAT invoice's "of which tax" table. Sorted by rate
  // descending so the standard rate leads.
  breakdown: { taxRate: number; taxableAmount: number; taxAmount: number }[];
  deliveryTaxAmount: number;
}

// Tax is computed PER LINE against that line's own class, not once against the
// whole subtotal — a shop selling a standard-rated bouquet and a zero-rated food
// item in one basket owes tax on the first only. Before this, one shop-level
// rate was applied to the entire goods subtotal and `product.chargeTax` was
// ignored outright, so a merchant with anything zero-rated or exempt overcharged
// VAT and filed a wrong return (capability audit I18N-5).
//
// Delivery is taxed only when the shop opts in via `shop.taxOnDelivery`, which
// defaults false — the behaviour this function has always had, and what its
// original header comment asked to revisit.
export function computeOrderTotals(params: {
  lines: TaxableLine[];
  deliveryFee: number;
  // An order-level discount (a code, or a manual adjustment). Apportioned across
  // lines pro rata by line amount, because it reduces the taxable base and with
  // mixed rates there is no single base to reduce. Tax is owed on what the
  // customer actually pays for the goods, not the pre-discount list price.
  discountAmount?: number;
  taxInclusive: boolean;
  taxOnDelivery?: boolean;
  // The rate delivery is charged at when taxOnDelivery is on — the shop's
  // default (standard) class. Delivery is a service the shop supplies; it has no
  // tax class of its own in this model.
  deliveryTaxRate?: number;
}): OrderTotals {
  const {
    lines,
    deliveryFee,
    discountAmount = 0,
    taxInclusive,
    taxOnDelivery = false,
    deliveryTaxRate = 0,
  } = params;

  const grossSubtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  // A discount larger than the basket cannot make the taxable base negative.
  const effectiveDiscount = Math.min(
    Math.max(discountAmount, 0),
    grossSubtotal,
  );

  const computed: ComputedLineTax[] = lines.map((line) => {
    // Pro-rata share. Guarded against a zero-value basket (a 100%-discounted
    // order, or a free item) where there is nothing to apportion against.
    const share = grossSubtotal > 0 ? line.amount / grossSubtotal : 0;
    const net = line.amount - effectiveDiscount * share;
    const factor = 1 + line.taxRate / 100;
    if (taxInclusive) {
      // The price already contains the tax: back it out rather than adding it
      // again on top.
      const taxableAmount = factor === 0 ? net : net / factor;
      return {
        taxClassId: line.taxClassId,
        taxRate: line.taxRate,
        taxableAmount,
        taxAmount: net - taxableAmount,
      };
    }
    return {
      taxClassId: line.taxClassId,
      taxRate: line.taxRate,
      taxableAmount: net,
      taxAmount: net * (line.taxRate / 100),
    };
  });

  const netSubtotal = grossSubtotal - effectiveDiscount;
  const lineTax = computed.reduce((sum, l) => sum + l.taxAmount, 0);

  let deliveryTaxAmount = 0;
  if (taxOnDelivery && deliveryFee > 0 && deliveryTaxRate > 0) {
    const factor = 1 + deliveryTaxRate / 100;
    deliveryTaxAmount = taxInclusive
      ? deliveryFee - deliveryFee / factor
      : deliveryFee * (deliveryTaxRate / 100);
  }

  const taxAmount = lineTax + deliveryTaxAmount;
  // Inclusive: every amount already contains its tax, so the total is just what
  // was charged. Exclusive: the tax is genuinely additional.
  const total = taxInclusive
    ? netSubtotal + deliveryFee
    : netSubtotal + deliveryFee + taxAmount;

  const byRate = new Map<
    number,
    { taxableAmount: number; taxAmount: number }
  >();
  for (const line of computed) {
    const entry = byRate.get(line.taxRate) ?? {
      taxableAmount: 0,
      taxAmount: 0,
    };
    entry.taxableAmount += line.taxableAmount;
    entry.taxAmount += line.taxAmount;
    byRate.set(line.taxRate, entry);
  }
  if (deliveryTaxAmount > 0) {
    const entry = byRate.get(deliveryTaxRate) ?? {
      taxableAmount: 0,
      taxAmount: 0,
    };
    entry.taxableAmount += taxInclusive
      ? deliveryFee - deliveryTaxAmount
      : deliveryFee;
    entry.taxAmount += deliveryTaxAmount;
    byRate.set(deliveryTaxRate, entry);
  }

  return {
    taxAmount,
    total,
    lines: computed,
    deliveryTaxAmount,
    breakdown: [...byRate.entries()]
      .map(([taxRate, v]) => ({ taxRate, ...v }))
      .sort((a, b) => b.taxRate - a.taxRate),
  };
}

interface ZoneLike {
  name: string;
  isActive: boolean;
}

// Zones aren't modeled with a dedicated area/emirate column — they're a
// free-text `name` (e.g. "Dubai", "DXB/SHJ/AJM") — so matching is a
// case-insensitive compare against the customer's area first (more
// specific), falling back to their emirate. Flag back if zones should
// instead carry a structured area/emirate list.
export function matchDeliveryZone<Z extends ZoneLike>(
  zones: Z[],
  area: string | null | undefined,
  emirate: string,
): Z | null {
  const active = zones.filter((z) => z.isActive);
  const norm = (s: string) => s.trim().toLowerCase();
  if (area?.trim()) {
    const byArea = active.find((z) => norm(z.name) === norm(area));
    if (byArea) return byArea;
  }
  return active.find((z) => norm(z.name) === norm(emirate)) ?? null;
}
