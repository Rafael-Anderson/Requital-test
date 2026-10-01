# p3a-stock-consumption-record (F1, F2, F9, F10, F11), branch fix/stock-consumption-record

STACKED ON `fix/stock-transition-cas` (F5). Merge that one first; this branch's diff against it is
only the record. Migration: `20261010100000_order_stock_consumption` (additive; the only one).
Not touched, by instruction: F7, F12 (characterisation specs untouched and passing), F3, F4, F6.

## Hypothesis: CONFIRMED for F1, F2, F9, F10, F11 (VERIFIED by reading each path, then by injection)
Every restock and every delta was derived from today's recipe/flags, not from what the order took:
- F10: cancel restocked via `consumeForOrderItems(+1)`, which re-reads `productingredient` now; a
  return did the same (returns.service.ts, old ~181-210). Nothing stored what was consumed.
- F9: cancel was gated by `order.ingredientsConsumedAt`; the return path had no such gate.
- F11: the return path gated on `product.trackInventory`, consume (confirm) gated only on
  `ingredient.trackInventory`.
- F2: an increase-edit re-checks the TOGGLE in `consumeForOrderItems` (direction -1) though it extends
  an already-happened consumption, while cancel (+1) ignores it and returns the full new quantity.
- F1: `updateItems` only adjusted when `status === 'confirmed'`, on the false comment that a pending
  immediate-channel order "has never run consumeForOrderItems" (it reserves at creation).
Refuted: none. F5 is a different mechanism (a stale pre-transaction read) and is the other branch.

## Mechanism
- `orderstockconsumption` (shopId, orderId FK cascade, productId, variantId (no FK, see below),
  generated `variantKey`, ingredientId FK cascade, quantity INT = NET held), unique
  `(orderId, productId, variantKey, ingredientId)`. Keyed by the order-LINE identity (product +
  variant as the line names it), not the recipe row's variant, because returns and edits address lines.
- `order.consumptionRecordedAt` DATETIME NULL: set at creation (both INSERT sites: storefront checkout and
  `OrdersService.create`, which also serves draft-complete) and, for a pre-migration PENDING deferred admin
  order, at its confirm (which is when it first consumes, so its record is complete from there).
  **NULL = LEGACY: no backfill, no fabricated record; such orders keep exactly today's behaviour**
  (recipe-driven cancel/return, F9/F10/F11/F2 still present on them, F1 on a pending storefront order).
  Non-NULL with zero rows = the order took nothing (toggle off), a recorded fact.
- `ProductOrderItemsService`: `consumeForOrderItems` gains `options.orderId` (write the record now) or
  `options.collect` (checkout reserves BEFORE the order row exists, so the caller gets the rows and calls
  `recordOrderConsumption` after the insert); passing either with direction +1 throws. New
  `releaseOrderConsumption(conn, { shopId, outletId, orderId, ..., only?: [{productId, variantId, num, den}] })`
  reads the rows FOR UPDATE, gives back `quantity` (or `floor(quantity*num/den)` of a line, whole line when
  num >= den), zeroes them in place (rows are never deleted so "released" != "never written"), and writes the
  stock increment + a `stockmovement` row on the same connection, so SUM(delta) == stock still holds. It
  checks the outlet belongs to the shop before writing stock.
- Cancel (`adjustStockForOrder`, both CAS branches): reads the state with `readConsumptionState` (FOR UPDATE,
  inside the CAS-winning tx), then releases the whole record; LEGACY falls back to the recipe path gated by
  the fresh `ingredientsConsumedAt`. Movement type stays `CONSUMED` (W5 asserts `[-QTY, QTY]`).
- Confirm: records what it took and stamps `consumptionRecordedAt`/`ingredientsConsumedAt`.
- `updateItems`: for a recorded order, adjusts whenever stock is reserved (immediate channel any status,
  or confirmed), increases record into the order's own rows, decreases release `k of oldQty` of the line's
  held quantity. LEGACY keeps the old confirmed-only recipe rule.
- Returns: for a recorded order, locks the order row, computes the remaining units per line identity inside
  the tx, and releases `n of remaining` (type `RETURN`), ignoring `product.trackInventory` and the toggle.
  LEGACY keeps the gated recipe restock. `orderreturn.restocked` semantics unchanged.

## Behaviour changes worth the coordinator's eye (money/stock semantics)
1. A mixed-recipe line (recipe edited after the sale, then a partial edit-down or return) restocks the
   AVERAGE held per unit, rounded DOWN (never more than held). Exact for every uniform case.
2. `updateItems` on a pending storefront/draft order now moves stock (F1): an INCREASE reserves with the
   same floor check as a confirmed edit (plain product: 409 when short; recipe: warns).
3. Back-in-stock notifications on cancel now fire only when stock actually came back (before: whenever a
   cancel ran, even for an order that took nothing).
4. A return of an order that took nothing no longer adds stock (F9) - for RECORDED orders only.
   A pre-migration (legacy) delivered order returned after this deploy behaves as before.

## Known limitations (INFERRED unless noted)
- A variant deleted after the sale leaves `orderitem.variantId` NULL (FK SET NULL, VERIFIED in schema) while
  the record keeps the old id (deliberately no FK: SET NULL there could violate the unique key). A PARTIAL
  return of such a line finds no matching row and restocks nothing; a CANCEL releases every row regardless.
- Several lines of one order sharing product+variant (e.g. different notes) pool into one record row; returns
  split it proportionally over the pooled remaining units.
- No new endpoint, so no new cross-tenant endpoint test; shop scoping is asserted at the row level in
  `order-stock-consumption.e2e-spec.ts` (rows carry the order's shopId; another shop cannot cancel the order).
- `consumptionRecordedAt` appears in order JSON like `ingredientsConsumedAt` already does (SELECT * spread);
  not stripped, no frontend reads it.

## Tests (VERIFIED)
- `stock-update-items` (F1 x2, F2), `return-restock-bom` (F9, F10a, F10b, F11): `test.failing` -> plain `it`.
  Their "actual: ..." comments rewritten to "was ...". The F10 *precondition* test used to pin the buggy
  96; it now asserts the recipe edit was accepted and the restock is 100 (the bug it characterised is gone),
  and two LEGACY characterisations (cancel 96, return 112) pin that orders without a record are unchanged.
- New `order-stock-consumption.e2e-spec.ts` (11): record written with checkout in one tx and rolled back
  with a lost race; admin deferred lifecycle; toggle-off empty record; split returns; mixed recipe;
  variant line; edit-down on pending storefront; line removal; row-level tenant scoping; LEGACY edit writes
  no partial record.
- Injection (each reverted, failing spec named, then restored): cancel forced to the recipe path -> F10a, F2,
  F10 precondition, admin-lifecycle; return forced to the recipe path -> F9, F10b, F11 + 3 new; `updateItems`
  forced to the legacy rule -> F1 and the edit-down spec. (F1's "consequence" spec passes under that last
  injection because the record alone returns the right amount on cancel.)
