# p3b-f3-f4-f6 handoff (branch fix/stock-money-f3-f4-f6)

No migration. Three fixes, each W5 `test.failing` is now a plain `it` (F3, F4a, F4b, F6).

## F3 (variant recipe override double-costed)
- Cause (VERIFIED): `product-order-items.service.ts` `recipeFor()` took product-wide rows PLUS the variant's rows; `consumeForOrderItems` (same file) uses the variant's rows INSTEAD when any exist.
- Fix: `recipeFor` now uses the same replace-not-merge rule. unitCost = override only (20, was 32 in the W5 case). No other code computes recipe cost this way (grep'd `variantId === null ||`).
- Existing captured `orderitem.unitCost` rows are NOT rewritten (cost is captured once at the event). INFERRED: historical margin for variant-override orders is understated; not corrected.

## F4 (bulk-adjust non-atomic, no ledger)
- `ProductStockService.adjustStock`: pre-transaction SELECT floor check replaced by a CAS floor inside ONE transaction (`stockQuantity >= ?` in the decrement's WHERE); any failing line rolls back the batch. Every line writes a `stockmovement` (`ADJUSTMENT`, reason NULL, note 'Bulk adjust', actor, productId/variantId/ingredientId) so SUM(delta) = stock. Lines are processed in ingredientId order (consistent lock order across concurrent batches).
- Validation unchanged and verified to run before any write: outlet belongs to shop (400), branch user forced to own outlet, `assertPermission(products.manage_stock)`, every product/variant shop-scoped via `resolveShadowStockTarget` (foreign product 404). New e2e `test/stock-bulk-adjust.e2e-spec.ts` covers foreign product and foreign outlet (nothing written), atomicity, ledger rows, duplicate lines.
- BEHAVIOUR CHANGE: floor failure was 400 BadRequest, is now 409 Conflict (same as `POST /products/stock/adjust`). No existing test or admin code depended on 400 (grep'd). Message unchanged.
- Notify: crossing 0->positive is now detected inside the transaction (exact, not a pre-read) and fired after commit; same `triggerForProduct` call. `notify-subscriptions` spec #1 passes. Also consistent with other paths: transfer fires when destination was <=0; scan/import/cancel unchanged (not touched).
- Removed the W5 `it` "bulk-adjust race precondition ... characterises F4a" (it asserted the buggy behaviour, all four racers 200, which can no longer be true); the F4a `it` replaces it. This is the only W5 test removed; it was a characterisation, not a `test.failing`.
- Conservation spec untouched.

## F6 (gift-card refund split unrounded)
- `ReturnsService.create`: `refundAmount` rounded with `roundMoney(order.currency)`; the gift/provider split now computed in integer minor units (`minorUnitFactor`), gift share rounded once, provider share = remainder, so parts sum exactly to refundAmount. KWD (factor 1000) tested.
- Extra (my addition, needed so the card is made whole): gift share is capped at what is still unreturned of `giftCardAmount` (new `SUM(giftCardRefundAmount)` in the existing prior-returns query), and the return that completes the refund returns all the remainder, so per-return rounding cannot create or lose a fils across several returns. Test: KWD two-return case returns exactly 10.000 to the card.
- The prior default (`refundAmount` ignores apportioned discount/tax, F7) untouched.

## Injection proof (VERIFIED, src stashed, specs kept)
F3: unitCost 32 vs 20. F4a: 4 racers all 200 (<=1 expected). F4b: stock 5 vs 9 / ledger. F6: 42.735042... not whole minor unit; KWD 2.985609... vs 2.986. New bulk spec: ledger, atomic (400 vs 409) fail on old code.

## Not touched
F1 F2 F5 F9 F10 F11 F7 F12; `consumeForOrderItems`, cancel/CAS paths, restock loop in returns. Rebase risk: `returns.service.ts` (my edits are in the refund-amount/split block and the prior-returns SELECT only) and `product-order-items.service.ts` (only `recipeFor`).
