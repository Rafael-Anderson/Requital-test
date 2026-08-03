export const ORDER_STATUSES = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

// Linear happy path; 'cancelled' is reachable from any non-terminal status
// but the flow never moves backwards otherwise.
const STATUS_ORDER: OrderStatus[] = [
  'pending',
  'confirmed',
  'preparing',
  'out_for_delivery',
  'delivered',
];

export function isValidStatusTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  if (from === 'delivered' || from === 'cancelled') return false;
  if (to === 'cancelled') return true;
  const fromIndex = STATUS_ORDER.indexOf(from);
  const toIndex = STATUS_ORDER.indexOf(to);
  return toIndex === fromIndex + 1;
}

export const PAYMENT_STATUSES = ['unpaid', 'paid', 'refunded'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

// Channels whose orders reserve stock atomically at creation time (see
// OrdersService.create's reserveStock option) rather than deferring the
// decrement to the 'confirmed' transition — storefront checkout and
// completed draft orders both need that immediate guarantee. cancel()/
// updateStatus() key their restock-timing branch off this list rather than
// a single hardcoded 'storefront' check, so a still-pending order from
// either channel restocks correctly on cancel and never double-decrements
// on confirm.
export const IMMEDIATE_STOCK_RESERVATION_CHANNELS = [
  'storefront',
  'draft_order',
];

// #9: items can be added/removed/quantity-adjusted only while the order is
// 'pending' or 'confirmed' — before 'preparing' starts. Once preparing
// begins, staff have physically started assembling the order; changing the
// item list past that point means discarding real work already done, which
// this feature deliberately doesn't try to reconcile. 'cancelled'/
// 'delivered' are terminal states already excluded by not being pending/confirmed.
export const EDITABLE_ORDER_STATUSES: OrderStatus[] = ['pending', 'confirmed'];

export const EMIRATES = [
  'Abu Dhabi',
  'Dubai',
  'Sharjah',
  'Ajman',
  'Umm Al Quwain',
  'Ras Al Khaimah',
  'Fujairah',
] as const;
export type Emirate = (typeof EMIRATES)[number];
