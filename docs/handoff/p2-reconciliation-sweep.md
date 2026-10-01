# p2-reconciliation-sweep handoff

Branch `fix/reconciliation-sweep-starvation`. Migration `20261009100000_payment_reconciliation_state`.

## Investigation (VERIFIED, origin/main code)
- `backend/src/payments/payment-reconciliation.service.ts`: `@Cron(EVERY_10_MINUTES)` -> `schedulerService.runLocked('payment-reconciliation-sweep', 600, ...)` -> `runSweep()`.
- Candidate query: `paymentStatus='unpaid'`, session id+gateway set, `status<>'cancelled'`, `createdAt` between now-7d and now-20min, `ORDER BY createdAt ASC LIMIT 50`. "Stale" = old with a session; there is no staleness marker, and the sweep kept no memory of having asked.
- Per candidate: `reconcileOne` -> `resolveCredentials` -> ONE `provider.retrieveSessionOutcome` (Stripe `checkout.sessions.retrieve`). Only Stripe implements it. `paid` -> `PaymentsService.applyWebhookResult` (the single mark-paid path; also the webhook path) with `providerReference = reconciled:<sessionId>`; idempotency = unique `(gateway, gatewayReference)` on `paymenttransaction` (duplicate/lock conflict = already processed); CAPI dedupe key `capi:purchase:<orderId>` is separate and untouched.
- Starvation mechanism: an unpaid-but-never-paid order stays a candidate for 7 days (`unpaid`/`expired` outcomes changed nothing), and ordering was oldest-first, so the 50 oldest were re-polled every tick; with >50 of them a newer paid order is never selected. Reproduced: the new spec fails on the old service (`paymentStatus` stays `unpaid`).

## Fix
- New table `paymentreconciliation (orderId PK, shopId, lastCheckedAt, settledAt NULL)`, FK cascade to order and shop, no backfill (no row = never checked). Separate table instead of an `order` column because `order` is `SELECT *`-spread into responses (attributionJson precedent); this table is selected nowhere in any API path, so nothing can leak.
- Selection: never-checked first, **newest first**; then checked rows oldest-`lastCheckedAt` first once their window elapsed; `LIMIT 50` kept. Newest-first for never-checked is deliberate: a Stripe session lives 24h, so only recent orders can still flip to paid; strict oldest-first would take 3 ticks for the 121st candidate (violates the two-tick requirement). Known ceiling (ponytail comment): starves an old never-checked row only if >50 new unpaid sessions arrive per 10 minutes.
- Backoff by order age: <2h 10 min, <24h 60 min, older 12h (`RECHECK_MINUTES`). SELECT and claim use the same SQL expression.
- Claim = CAS before the Stripe call: `INSERT IGNORE` (first check, PK decides) or `UPDATE ... WHERE lastCheckedAt < now-window`; only the claimant calls Stripe, so overlapping ticks / processes cannot double-check. A failing call still consumes the window (so a poison order cannot monopolise the budget); a paid answer whose apply throws waits out its window (<=1h for a live session). INFERRED acceptable, not tested.
- Stop-forever: Stripe `expired` (terminal) sets `settledAt`; never polled again. Order/payment status are NOT changed (no new statuses). The existing 7-day window is kept as the outer horizon.
- `applyWebhookResult` and idempotency untouched.

## Tests (`backend/test/payment-reconciliation.e2e-spec.ts`)
- New: 120 stale + 1 newer paid -> paid within 2 ticks via the real path, per-tick calls <= 50, no session asked twice; backoff re-ask after window + expired settles; two concurrent sweeps ask once. Stripe stubbed via `jest.spyOn` on the registry's provider, no network.
- Existing sweep specs made robust on a dirty DB: the stub is now keyed by session id (others answer `unpaid`), so leftover candidates can neither be marked paid nor hide the test order; the "twice" spec clears check state so it still exercises idempotency; the "too young" spec asserts its own session was not asked.
- Injection proof: old service restored -> the starvation spec fails at `expect(after.paymentStatus).toBe('paid')` (Received `unpaid`). Fixed service run twice back to back on the same (dirty) DB: 10/10 both times.

## Not verified
- Real Stripe behaviour (stubbed); 24h session lifetime is Stripe's default, the provider sets no `expires_at`.
