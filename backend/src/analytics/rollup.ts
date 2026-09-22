// ANL-1's arithmetic, kept pure so the cases that actually matter (an empty
// day, a day where only some lines carry a captured cost) are unit-testable
// without a database.
//
// Aggregating in JS rather than in one GROUP BY: the input is a single shop's
// single day, which is bounded and small, and the null-cost rule below is
// fiddly enough to be worth testing directly rather than inferring from a
// CASE WHEN. If a shop ever grows a day big enough for this to matter, the
// shape here maps onto SQL one-for-one.

// `unitCost` is the cost captured at order time (migration 20260921120000),
// NOT product.costPrice read today - that is the whole point of the column.
export interface RollupItemRow {
  orderId: number;
  productId: number;
  quantity: number;
  priceAtPurchase: string | null;
  unitCost: string | null;
}

export interface RollupOrderRow {
  id: number;
  outletId: number;
  customerId: number | null;
  deliveryFee: string | null;
  taxAmount: string | null;
  discountAmount: string | null;
}

export interface ShopDayMetrics {
  outletId: number;
  orders: number;
  revenue: string;
  cogs: string | null;
  discount: string;
  delivery: string;
  tax: string;
  newCustomers: number;
  returningCustomers: number;
  linesWithoutCost: number;
}

export interface ProductDayMetrics {
  productId: number;
  outletId: number;
  units: number;
  revenue: string;
  cogs: string | null;
  linesWithoutCost: number;
}

// mysql2 hands DECIMAL back as a string (see CLAUDE.md on trimDecimal), and a
// malformed one must not silently become 0 and understate a total - it is
// treated as absent, exactly like NULL.
function num(value: string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function money(value: number): string {
  return value.toFixed(2);
}

// Accumulates the two cost figures together because they are two halves of
// one decision: a line either contributes to `cogs` or to `linesWithoutCost`,
// never to both and never to neither.
class CostAccumulator {
  private costed = 0;
  private anyCosted = false;
  private missing = 0;

  add(quantity: number, unitCost: string | null): void {
    const cost = num(unitCost);
    if (cost === null) {
      this.missing += 1;
      return;
    }
    this.costed += quantity * cost;
    this.anyCosted = true;
  }

  // Null, not zero, when nothing in this bucket had a captured cost. A zero
  // would report as 100% margin downstream, which is a more confident lie
  // than "unknown" (the rule Part A established in product-cost.ts).
  get cogs(): string | null {
    return this.anyCosted ? money(this.costed) : null;
  }

  get linesWithoutCost(): number {
    return this.missing;
  }
}

function itemsByOrder(items: RollupItemRow[]): Map<number, RollupItemRow[]> {
  const map = new Map<number, RollupItemRow[]>();
  for (const item of items) {
    const list = map.get(item.orderId);
    if (list) list.push(item);
    else map.set(item.orderId, [item]);
  }
  return map;
}

// `revenue` is MERCHANDISE revenue - the sum of quantity x priceAtPurchase -
// not order.total. This is deliberate and the most important definition in
// this file: revenue paired with `cogs` has to be the same population of
// money, or `revenue - cogs` is not gross margin. order.total additionally
// carries delivery and tax and is already net of the order-level discount, so
// those three land in their own columns instead, where they can be analysed
// without contaminating the margin figure. priceAtPurchase is already reduced
// by any auto-discount (see ProductsService.resolveOrderItems), so an
// automatic markdown is reflected here while a typed code shows up in
// `discount`.
//
// `newCustomersOnThisDate` is the set of customer ids whose FIRST EVER order
// (shop-wide, any outlet) falls on the date being rolled up - the caller
// resolves it, since it is a whole-history question and this function only
// sees one day. An order with no customerId (a guest checkout that never
// produced a customer row) counts as neither new nor returning: there is no
// identity to classify, and guessing would double-count the same walk-in.
export function computeShopDayMetrics(
  orders: RollupOrderRow[],
  items: RollupItemRow[],
  newCustomersOnThisDate: ReadonlySet<number>,
): ShopDayMetrics[] {
  const byOrder = itemsByOrder(items);
  const perOutlet = new Map<
    number,
    {
      orders: number;
      revenue: number;
      discount: number;
      delivery: number;
      tax: number;
      cost: CostAccumulator;
      newCustomers: Set<number>;
      returningCustomers: Set<number>;
    }
  >();

  for (const order of orders) {
    let bucket = perOutlet.get(order.outletId);
    if (!bucket) {
      bucket = {
        orders: 0,
        revenue: 0,
        discount: 0,
        delivery: 0,
        tax: 0,
        cost: new CostAccumulator(),
        newCustomers: new Set<number>(),
        returningCustomers: new Set<number>(),
      };
      perOutlet.set(order.outletId, bucket);
    }

    bucket.orders += 1;
    bucket.discount += num(order.discountAmount) ?? 0;
    bucket.delivery += num(order.deliveryFee) ?? 0;
    bucket.tax += num(order.taxAmount) ?? 0;

    for (const item of byOrder.get(order.id) ?? []) {
      bucket.revenue += item.quantity * (num(item.priceAtPurchase) ?? 0);
      bucket.cost.add(item.quantity, item.unitCost);
    }

    if (order.customerId !== null) {
      const set = newCustomersOnThisDate.has(order.customerId)
        ? bucket.newCustomers
        : bucket.returningCustomers;
      set.add(order.customerId);
    }
  }

  return [...perOutlet.entries()]
    .map(([outletId, b]) => ({
      outletId,
      orders: b.orders,
      revenue: money(b.revenue),
      cogs: b.cost.cogs,
      discount: money(b.discount),
      delivery: money(b.delivery),
      tax: money(b.tax),
      newCustomers: b.newCustomers.size,
      returningCustomers: b.returningCustomers.size,
      linesWithoutCost: b.cost.linesWithoutCost,
    }))
    .sort((a, b) => a.outletId - b.outletId);
}

// Same population and the same null-cost rule, grouped by (product, outlet)
// so ANL-8 can ask per-product questions per branch.
export function computeProductDayMetrics(
  orders: RollupOrderRow[],
  items: RollupItemRow[],
): ProductDayMetrics[] {
  const outletOf = new Map(orders.map((o) => [o.id, o.outletId]));
  const buckets = new Map<
    string,
    {
      productId: number;
      outletId: number;
      units: number;
      revenue: number;
      cost: CostAccumulator;
    }
  >();

  for (const item of items) {
    const outletId = outletOf.get(item.orderId);
    // An item whose order is not in this day's set cannot be attributed, and
    // silently bucketing it under some default outlet would corrupt a
    // branch's numbers. Skipping is the only honest option.
    if (outletId === undefined) continue;

    const key = `${item.productId}:${outletId}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        productId: item.productId,
        outletId,
        units: 0,
        revenue: 0,
        cost: new CostAccumulator(),
      };
      buckets.set(key, bucket);
    }
    bucket.units += item.quantity;
    bucket.revenue += item.quantity * (num(item.priceAtPurchase) ?? 0);
    bucket.cost.add(item.quantity, item.unitCost);
  }

  return [...buckets.values()]
    .map((b) => ({
      productId: b.productId,
      outletId: b.outletId,
      units: b.units,
      revenue: money(b.revenue),
      cogs: b.cost.cogs,
      linesWithoutCost: b.cost.linesWithoutCost,
    }))
    .sort((a, b) => a.productId - b.productId || a.outletId - b.outletId);
}
