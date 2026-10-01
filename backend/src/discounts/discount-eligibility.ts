import { roundMoney } from '../common/currency-minor-units';

// THE one place that decides which order lines a discount applies to and how
// much it takes off. Everything that shows or charges a discount routes
// through here (validate endpoints, storefront checkout, admin/draft orders,
// the order-items edit, draft-order totals, and the auto-discount per-line
// markdown), so display and charge cannot drift.
//
// Pure on purpose: callers load lines from RESOLVED order items (server prices,
// server collection membership), never from client-supplied ids.

export interface DiscountScope {
  appliesTo: string;
  productIds: number[];
  collectionIds: number[];
}

export interface DiscountLine {
  productId: number;
  // Collections the product belongs to, read server-side.
  collectionIds: number[];
  // Line total in major units, AFTER any auto-discount markdown (the money the
  // customer actually pays for the line before a code).
  amount: number;
}

export interface DiscountEligibility {
  eligible: boolean;
  eligibleLineIndexes: number[];
  eligibleSubtotal: number;
  // Rounded once to the order currency's real minor unit. 0 for FREE_SHIPPING.
  discountAmount: number;
}

export function lineMatchesScope(
  scope: DiscountScope,
  line: { productId: number; collectionIds: number[] },
): boolean {
  if (scope.appliesTo === 'SPECIFIC_PRODUCTS') {
    return scope.productIds.includes(line.productId);
  }
  if (scope.appliesTo === 'SPECIFIC_COLLECTIONS') {
    return line.collectionIds.some((id) => scope.collectionIds.includes(id));
  }
  return true; // ALL_PRODUCTS
}

// Unrounded percent / fixed math against one base, capped at that base. Shared
// by the code path (base = eligible subtotal) and the auto-discount per-unit
// markdown (base = unit price).
export function computeDiscountAmount(
  discount: { type: string; value: string | number | null },
  base: number,
): number {
  if (discount.type === 'FREE_SHIPPING') return 0;
  const value = Number(discount.value ?? 0);
  if (discount.type === 'PERCENTAGE')
    return Math.min(base, (base * value) / 100);
  return Math.min(base, value);
}

export function computeEligibility(
  discount: DiscountScope & { type: string; value: string | number | null },
  lines: DiscountLine[],
  currency: string | null | undefined,
  // Legacy validate callers send only a cart total (no per-line amounts); the
  // amount is then taken on that whole total once any line is eligible. Order
  // creation never sets this.
  wholeCartSubtotal?: number,
): DiscountEligibility {
  const eligibleLineIndexes: number[] = [];
  lines.forEach((line, i) => {
    if (lineMatchesScope(discount, line)) eligibleLineIndexes.push(i);
  });
  // A legacy ALL_PRODUCTS check has a cart total but no lines to inspect.
  const eligible =
    eligibleLineIndexes.length > 0 ||
    (wholeCartSubtotal !== undefined && discount.appliesTo === 'ALL_PRODUCTS');
  const eligibleSubtotal =
    wholeCartSubtotal !== undefined
      ? eligible
        ? wholeCartSubtotal
        : 0
      : eligibleLineIndexes.reduce((sum, i) => sum + lines[i].amount, 0);
  return {
    eligible,
    eligibleLineIndexes,
    eligibleSubtotal,
    discountAmount: roundMoney(
      computeDiscountAmount(discount, eligibleSubtotal),
      currency,
    ),
  };
}
