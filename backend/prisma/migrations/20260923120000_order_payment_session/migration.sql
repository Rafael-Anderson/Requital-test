-- Fix 3a: remember which gateway checkout session an order is waiting on, so a
-- payment that was actually collected can be reconciled when its webhook never
-- arrives.
--
-- THE GAP THIS CLOSES. `paymentStatus = 'paid'` is written in exactly one place
-- for storefront orders: PaymentsService.handleWebhook. There is no
-- reconciliation anywhere - no cron touches unpaid orders, nothing calls
-- Stripe's sessions.retrieve. So if `checkout.session.completed` never arrives
-- (an unset STRIPE_WEBHOOK_SECRET makes verification throw, a misconfigured
-- endpoint, a transient delivery failure), the customer is charged, redirected
-- to a success page, and the order stays 'unpaid' forever with nothing to
-- detect it.
--
-- WHY A COLUMN AND NOT paymenttransaction. That table's unique
-- (gateway, gatewayReference) index is keyed on the webhook EVENT id and exists
-- purely for delivery idempotency (see its own schema comment and CLAUDE.md).
-- Storing a checkout SESSION id in the same column would overload one
-- identifier with two meanings and put session ids and event ids into the same
-- uniqueness space. It is also the wrong lifecycle: a paymenttransaction row
-- only exists once a payment event has been processed, which is precisely the
-- case reconciliation has to work WITHOUT.
--
-- Both nullable: an order paid in cash, covered entirely by a gift card, or
-- placed before this migration has no session, and that is a normal state
-- rather than missing data. The gateway is stored alongside the id because
-- shop.paymentGateway can change after the session was created, so it cannot be
-- re-derived later.
ALTER TABLE `order`
  ADD COLUMN `paymentSessionId` VARCHAR(191) NULL;

ALTER TABLE `order`
  ADD COLUMN `paymentSessionGateway` VARCHAR(191) NULL;

-- The reconciliation sweep is global (every shop, every tick), so it needs to
-- find candidates without scanning `order`. Leading with paymentStatus keeps the
-- scan to unpaid rows, which is a small and self-limiting slice - a paid order
-- leaves the candidate set permanently.
CREATE INDEX `Order_paymentStatus_sessionGateway_createdAt_idx`
  ON `order` (`paymentStatus`, `paymentSessionGateway`, `createdAt`);
