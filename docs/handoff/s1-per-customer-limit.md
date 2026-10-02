# s1-per-customer-limit (branch fix/discount-per-customer-limit)

## VERIFIED premise (file:line at origin/main 0c18f157)
- `DiscountsService.evaluate` checks `usageLimitPerCustomer` only when the caller passes `customerId`, via a plain `COUNT(*)` on `discountredemption` (discounts.service.ts ~405-415).
- `PublicService.createOrder` and `OrdersService.create` both call `evaluate` WITHOUT `customerId`, and resolve the customer (`findOrCreateForOrder`) after it. `redeem()` CAS-guards `usageLimit` only. So the limit was not enforced at storefront or admin create.
- Draft complete calls `OrdersService.create` (draft-orders.service.ts ~357), so it was equally unenforced; draft create/update passes `customerId` to `evaluate` only if the customer row already exists, so two drafts for a new phone both attach.
- `updateItems` re-evaluates with `customerId` but the count included the order's OWN redemption: with limit N, an order that used the code was dropped from the discount on any edit once its own use reached N (limit 1: always). Opposite of a bypass, but a real bug. Edits never call `redeem()`, so create-then-edit cannot add a redemption.

## Fix
- `DiscountsService.assertPerCustomerLimit(conn, shopId, discount, customerId)`: only when the discount has a per-customer limit, `SELECT ... FROM customer WHERE id=? AND shopId=? FOR UPDATE`, then plain COUNT of the customer's redemptions (joined to `discount.shopId`); >= limit throws 409 `ConflictException` (message from `DISCOUNT_REJECTION_MESSAGES.per_customer_limit_reached`). Called as the FIRST statement of the order transaction in `PublicService.createOrder` and `OrdersService.create` (draft complete goes through the latter). Global `usageLimit` CAS in `redeem()` unchanged.
- Why lock-the-customer-row-first: serialises same-customer orders. It must precede any read in the txn because the COUNT is a snapshot read under REPEATABLE READ (snapshot is taken at the first consistent read, so locking first makes it post-commit of the winner). A `COUNT(*) ... FOR UPDATE` was rejected: it gap-locks the (discountId, customerId) index and two different customers can deadlock inserting into the same gap (INFERRED from InnoDB locking rules, not reproduced).
- `evaluate` gained optional `excludeOrderId`; `updateItems` passes `order.id`.
- No migration.

## Decisions recorded
- Cancelled and unpaid orders STILL COUNT: nothing deletes a `discountredemption` row or decrements `timesUsed` on cancel/return, so per-customer follows the existing global-limit semantics. Pinned by a test; changing it (release on cancel) is an owner decision and must be done for both limits together.
- Customer identity is the existing `[shopId, phone]` row. Phones are stored RAW (storefront DTO regex allows spaces/hyphens/+; admin DTO has no format check), so "0501234567", "050 123 4567" and "+971501234567" are three customers and a guest can evade the limit by re-spelling their phone. NOT changed here (normalising the customer key changes customer identity/merging across the app); needs its own ticket. customerId is never NULL at redemption (the customer is always resolved before the transaction), so there is no NULL-bypass path in these flows.

## Tests
`backend/test/discount-per-customer-limit.e2e-spec.ts` (9): storefront, admin create (+ cross-path sharing), draft complete (two drafts attached before the customer existed), 6-way and limit-2 5-way concurrency, other customer / other shop, unlimited code, cancelled-still-counts, edit keeps discount and adds no redemption.
Injection: no-enforcement -> 7 fail; no `FOR UPDATE` -> both concurrency tests fail (all racers win); no `excludeOrderId` -> edit test fails.

## INFERRED / unverified
- Deadlock-avoidance reasoning above; the lock holds for the whole order txn only for orders using a per-customer-limited code.
