# s2-f7-return-refund (branch fix/return-refund-default-paid-share)

## What changed
- `backend/src/returns/return-refund.ts` (new, pure): `defaultReturnRefundMinor` + `orderIsTaxInclusive`. Reuses `computeReturnCredit` from `invoices/credit-note-amounts.ts` (the credit-note return computation), so refund and credit note share one function.
- `ReturnsService.create` now defaults the refund to the returned units' share of what was paid: captured line price net of the pro-rata order discount, plus captured line tax when the order is tax-exclusive (not on inclusive).
- Race fix: `create` is now one transaction. The order row `FOR UPDATE` lock is taken first and the order row, order lines, per-line returned quantity, cumulative refunded and gift-card share are all re-read after the lock. The provider call (provider-refund-with-manual-fallback, unchanged) happens after every cap has passed, still inside the lock. `paymentStatus = 'refunded'` is now set inside the same transaction.
- DTO comment updated. Tests: `return-refund-paid-share.e2e-spec.ts` (new, 12 cases), `src/returns/return-refund.spec.ts` (5 unit cases), F7 characterization in `order-gift-discount-tax.e2e-spec.ts` deliberately changed 100 -> 94.5 (renamed "F7 (fixed)").

## Design decisions (VERIFIED by tests unless marked)
- Telescoping: refund = credit(all units returned incl. this) - credit(units returned before), each rounded once to a minor unit. Any split of partial returns sums EXACTLY to the credit of the whole; the completing return carries the rounding remainder.
- Default is clamped to `order.total - deliveryFee - alreadyRefunded` (min 0): the delivery fee is not refunded by default (today's behaviour: price x qty never included delivery either), and the clamp absorbs a possible 1 minor unit gap between per-line captured figures and the separately rounded order total. A manual `refundAmount` is never clamped, only rejected (400) when cumulative > total, now compared in integer minor units.
- Tax mode is INFERRED from the order's own figures (`orderIsTaxInclusive`: stored total closer to net+delivery, or to net+delivery+taxAmount), because the order row has no tax-mode column and `shop.taxInclusive` may have been flipped since. Tested: flipping the shop toggle after the order changes nothing. If a tax-mode column on `order` is ever added, prefer it.
- LEGACY (any returned line has `orderitem.taxAmount` NULL = unknown): `defaultReturnRefundMinor` returns null and the service keeps the old default price x qty (no discount, no tax). Tested (NULL set via SQL), returns 100 on the discounted fixture.
- Gift-card/provider split (F6) is untouched; it now takes the paid share as `refundMinor`. Delivery gift share is unchanged.
- INFERRED limitation: a code scoped to specific products/collections discounts only eligible lines (P1), but the per-line discount share used here is the pro-rata-over-all-lines rule `computeOrderTotals`/the credit note use (same rule the tax capture used); there is no per-line discount capture to do better.
- INFERRED limitation: the provider refund is called inside the DB transaction holding the order lock (needed so caps are race-safe before any provider call). A slow gateway holds that order's lock for its duration; as before, if the DB write after a successful provider call failed, the provider would have refunded without a record (ordering unchanged from before).

## Compatibility with fix/returns-branchrole-permission
That PR adds `assertPermission(ctx, order.outletId, 'orders.manage')` right after `ordersService.findOne` in `create`. The first lines of `create` (signature, findOne, delivered check) are unchanged here, so it should merge cleanly; keep its call there. `returns.module.ts` untouched.

## Not done / follow-ups
- No behavioural test of the provider refund amount (CLAUDE.md known coverage gap) is added here.
- Credit notes for a return still compute from their own call; they and the refund now agree by construction for a same-quantity return.
