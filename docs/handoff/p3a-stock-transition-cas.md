# p3a-stock-transition-cas (F5), branch fix/stock-transition-cas

Based on origin/main (9d82305a). Independent of the consumption-record branch; that branch
(`fix/stock-consumption-record`) is STACKED ON THIS ONE. Merge order: this, then that.
No migration.

## Root cause (VERIFIED: file:line, and by injection)
- `OrdersService.cancel` read `order.ingredientsConsumedAt` in `findOne` BEFORE its transaction and
  passed `!== null` into `adjustStockForOrder` (old orders.service.ts ~1229/1248). The comment on
  `adjustStockForOrder` claimed "confirm and cancel are both CAS-guarded, so at most one can ever
  win", which is wrong: confirm (`pending->confirmed`) and a cancel's SECOND CAS branch
  (`confirmed->cancelled`) both succeed in sequence. A cancel that read the order while still
  `pending` and then queued behind a confirm acted on a NULL stamp, skipped the restock, and the
  confirm's decrement leaked for good.
- Sibling of the same bug: `updateItems` decided everything (status, `stockReserved`,
  `ingredientsConsumedAt`) from a pre-transaction read and had NO status CAS and no row lock.
  Found (not in the brief, same mechanism) by writing the interleaving tests:
  * edit parked behind a cancel: the edit applied a stock delta to an already restocked order
    (in the unfixed code the two requests actually DEADLOCK on the order row vs the stock row: 500).
  * edit parked behind a confirm of a pending admin order: edit replaced the items with no stock
    delta after confirm had consumed the OLD items (stock and order disagree for good).
  * two concurrent identical edits of a confirmed order both read the same stale `orderitem`
    snapshot and both consumed the delta (stock 30, order edited 1->10 twice: ended 11, correct 20).

## Fix
- `OrdersService.readConsumedFlag(conn, shopId, orderId)`: `SELECT ingredientsConsumedAt ... FOR UPDATE`
  (a current read, not the tx snapshot) on the transaction's own connection, called AFTER the status
  CAS has won in both cancel branches. The CAS UPDATE holds the row lock, a racing confirm has
  committed its decrement and its stamp by then (same transaction, same lock), so the read sees them.
- `updateItems`: first statement of the transaction is `SELECT status, ingredientsConsumedAt FROM order
  ... FOR UPDATE`; a status different from the one the edit was decided on is a 409 (retryable); the
  locked stamp replaces the stale one. The `orderitem` re-read that follows now happens after the
  lock, so it sees a prior edit's result.
- The wrong comment is replaced (adjustStockForOrder / readConsumedFlag).

## Tests (VERIFIED)
- `test/stock-concurrency-ledger.e2e-spec.ts`: F5 `test.failing` -> plain `it`, unchanged assertions.
  The `raceOnOrder` helper no longer uses its two fixed 500ms sleeps: it polls
  `performance_schema.data_lock_waits` joined to `data_locks` (schema = DATABASE(), table `order`,
  LOCK_DATA = the order id, so parallel specs cannot satisfy it) until the expected number of
  requests is actually queued on THIS order's row, with a 20s hard timeout that fails loudly.
  Requires the app DB user to read performance_schema (true on the dev/CI MySQL 8 here; CI uses the
  root service-container user). If that ever becomes false the spec fails with the timeout message.
- New: edit-after-cancel (409, stock 10, conserved), edit-after-confirm (409, stock 7, conserved),
  two identical concurrent edits (stock 20, conserved).
- `test/order-items-edit.e2e-spec.ts` "race: two concurrent quantity-increase edits": its assertion
  `succeeded <= 1` pinned an incidental outcome (the second edit only got 409 because stock happened
  to be exhausted; with spare stock it double-consumed, see above). Now: at least one 200, 200+409/500
  == 2, and final stock EXACTLY 0 (10 on the order, 10 consumed). This is a deliberate change of an
  existing non-W5 assertion, stronger on the invariant that matters; flagging it for the coordinator.
- Injection (revert orders.service.ts only): F5 fails `Expected 10 / Received 7`; edit-after-cancel
  `Expected 201 / Received 500` (deadlock); edit-after-confirm `Expected 409 / Received 200`;
  two-identical-edits `Expected 20 / Received 11`. All pass restored.

## Not changed / notes
- Legacy behaviour is untouched: this branch only changes WHEN the stamp is read.
- `updateStatus` (confirm) already ran its decrement under the CAS row lock; unchanged.
- Returns require `delivered`, cancel refuses `delivered`, so return vs cancel cannot interleave;
  not touched here (return restock mechanics are in the consumption-record branch).
