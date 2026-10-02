# s3-f12-auto-deduct (branch fix/auto-deduct-recipe-only)

Owner decision on F12: `shop.autoDeductIngredientStock` governs RECIPE-BACKED products only; PLAIN products always decrement and restock.

## Evidence (VERIFIED by reading + tests)
- The only src reader of the toggle is `ProductOrderItemsService.consumeForOrderItems` direction -1 (`FeaturesService.isEnabled(shopId,'auto_deduct_ingredient_stock',conn)`). Every decrement path routes through it: storefront checkout (`public.service.ts` createOrder), `OrdersService.create` reserveStock (admin and draft-orders complete, which calls `ordersService.create` with reserveStock:true), confirm (`adjustStockForOrder` direction -1), `updateItems` increase. Direction +1 and `releaseOrderConsumption` never read the toggle (record driven).
- No other reader: shop.service/dto only write it; `tools/check-feature-flags.js` still passes (read stays inside FeaturesService).

## The rule
Per line, the effective recipe is the variant's own override rows, else the product-level rows. A line is PLAIN iff EVERY effective row's ingredient is a shadow ingredient (`ingredient.shadowProductId` or `shadowVariantId` not null; the auto-created quantityPerUnit=1 stand-in). Any real ingredient in the effective recipe makes it recipe-backed. With the toggle off, `consumeForOrderItems(-1)` skips recipe-backed lines and processes plain lines normally (same trackInventory / continueSellingOutOfStock / CAS-floor semantics, since the shadow mirrors trackInventory and `allowNegative` is per line).
- Variant recipe overrides exist only on usesIngredients products (the variant PATCH ignores `ingredients` otherwise), so they are real-recipe and count as recipe-backed; a plain product's variants have shadow-variant ingredients and count as plain.

## Order-level stamp / record
No change needed: `consumeForOrderItems` returns true only if something was consumed, and `recorded` rows only hold what was taken. So with toggle off a plain-only order stamps `ingredientsConsumedAt` and records its plain rows; a recipe-only order stamps nothing and has a present-but-empty record (unchanged); a mixed order records only the plain rows. Cancel/return/edit-down release exactly the record, so ledger conservation holds.

## LEGACY (consumptionRecordedAt IS NULL) keeps today's behaviour
New option `legacyOrder` on `consumeForOrderItems`: toggle off returns false (takes nothing, plain included). Passed from `adjustStockForOrder` confirm (reads `readConsumptionState` first, row already locked by the status CAS) and from `updateItems` increase when `!hasStockRecord`. Creation paths are new orders by definition.
- Known consequence (INFERRED, by design): a legacy pending order confirmed with toggle off still takes nothing and is opted into an empty record at confirm (as before); later edits on it are then record-driven new-order behaviour.

## Tests
- NEW `backend/test/stock-auto-deduct-toggle.e2e-spec.ts` (32 tests): {admin confirm, storefront reserve, draft complete} x {plain, recipe} x {toggle on, off}, each with cancel (toggle flipped before cancel) and delivered full-return symmetry + ledger conservation; plain-variant case; mixed basket confirm/record; F2 scenario (toggle flipped between confirm and increase-edit); edit-down with toggle off; 3 LEGACY cases; cross-shop isolation.
- CHANGED DELIBERATELY: `stock-cancel-restock.e2e-spec.ts` "CHARACTERIZATION (finding F12)" now pins the new behaviour (plain decremented with toggle off, oversell rejected 409). The W5 recipe specs (F2, F9, F10...) are unmodified.
- Admin: copy updated in settings/business/information (label + hint, no em dashes), pinned by a new vitest in `page.test.tsx`.

## Not verified
- No live-browser check of the admin copy. Variant-override-on-recipe-product skip with toggle off is covered by rule/reading only (no dedicated cell; the override path is the same recipe branch).
