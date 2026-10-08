import { lineAmount, sumAmounts } from './purchase-order-rules';

// INV-5 pure maths. No I/O, so the rules are unit-tested without a database.
//
// THE RULE (a classic (s, Q) policy on the inventory POSITION):
//   position = stock now + quantity still outstanding on open purchase orders
//              for the same outlet and ingredient (draft, sent, partially_received)
//   reorder  = reorderPoint is set AND position <= reorderPoint
//   quantity = reorderQuantity x ceil((reorderPoint + 1 - position) / reorderQuantity)
//              i.e. whole multiples of the reorder quantity until the position is
//              back above the point, then raised to the supplier's minimum order
//              quantity if it has one.
// A draft counts as on order on purpose: it is what makes "create draft POs"
// idempotent (the second click finds the first click's drafts and has nothing left
// to order) and the merchant can see and delete the draft if they changed their mind.

export const MAX_LINE_QUANTITY = 1_000_000;

export interface ReorderCandidate {
  stock: number;
  onOrder: number;
  reorderPoint: number | null;
  reorderQuantity: number | null;
}

export type SkipReason = 'no_reorder_point' | 'no_reorder_quantity' | 'covered';

export function positionOf(c: Pick<ReorderCandidate, 'stock' | 'onOrder'>): number {
  return c.stock + Math.max(0, c.onOrder);
}

// Returns the base quantity to order, or the reason there is nothing to order.
// Unknown stays unknown: a missing point is never read as 0.
export function baseOrderQuantity(
  c: ReorderCandidate,
): { quantity: number } | { skip: SkipReason } {
  if (c.reorderPoint === null) return { skip: 'no_reorder_point' };
  const position = positionOf(c);
  if (position > c.reorderPoint) return { skip: 'covered' };
  if (c.reorderQuantity === null || c.reorderQuantity < 1) {
    return { skip: 'no_reorder_quantity' };
  }
  const shortfall = c.reorderPoint + 1 - position;
  return {
    quantity: c.reorderQuantity * Math.ceil(shortfall / c.reorderQuantity),
  };
}

export function applyMinOrderQty(
  quantity: number,
  minOrderQty: number | null,
): number {
  const q = minOrderQty !== null && minOrderQty > quantity ? minOrderQty : quantity;
  return Math.min(q, MAX_LINE_QUANTITY);
}

export interface SupplierOption {
  supplierId: number;
  unitCost: number;
  currency: string;
  minOrderQty: number | null;
  leadTimeDays: number | null;
}

// Which supplier a needed ingredient is bought from. There is no "preferred
// supplier" column, so the rule is stated here and shown to the merchant:
//   1. one currency among the options: the cheapest unit cost wins
//   2. several currencies: prices in different currencies are not comparable and
//      no rate is applied, so the shortest known lead time wins (unknown last)
//   3. ties: shorter lead time, then the lowest supplier id (deterministic)
export function pickSupplier(options: SupplierOption[]): {
  chosen: SupplierOption;
  priceComparable: boolean;
  alternatives: number;
} | null {
  if (options.length === 0) return null;
  const currencies = new Set(options.map((o) => o.currency));
  const priceComparable = currencies.size === 1;
  const lead = (o: SupplierOption) => o.leadTimeDays ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...options].sort(
    (a, b) =>
      (priceComparable ? a.unitCost - b.unitCost : 0) ||
      lead(a) - lead(b) ||
      a.supplierId - b.supplierId,
  );
  return {
    chosen: sorted[0],
    priceComparable,
    alternatives: options.length - 1,
  };
}

export interface SuggestionLine {
  ingredientId: number;
  quantity: number;
  unitCost: number;
  currency: string;
  lineTotal: number;
}

export interface SuggestionGroup<L extends SuggestionLine = SuggestionLine> {
  outletId: number;
  supplierId: number;
  currency: string;
  lines: L[];
  subtotal: number;
}

// One group per (outlet, supplier, currency). A supplier whose items are priced
// in two currencies yields two groups, so a purchase order never mixes
// currencies and no currency is ever invented for a line.
export function groupByPurchaseOrder<L extends SuggestionLine>(
  entries: (L & { outletId: number; supplierId: number })[],
): SuggestionGroup<L>[] {
  const groups = new Map<string, SuggestionGroup<L>>();
  for (const e of entries) {
    const key = `${e.outletId}|${e.supplierId}|${e.currency}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        outletId: e.outletId,
        supplierId: e.supplierId,
        currency: e.currency,
        lines: [],
        subtotal: 0,
      };
      groups.set(key, g);
    }
    g.lines.push(e);
  }
  for (const g of groups.values()) {
    g.lines.sort((a, b) => a.ingredientId - b.ingredientId);
    g.subtotal = sumAmounts(
      g.lines.map((l) => lineAmount(l.quantity, l.unitCost, g.currency)),
      g.currency,
    );
  }
  return [...groups.values()].sort(
    (a, b) =>
      a.outletId - b.outletId ||
      a.supplierId - b.supplierId ||
      a.currency.localeCompare(b.currency),
  );
}
