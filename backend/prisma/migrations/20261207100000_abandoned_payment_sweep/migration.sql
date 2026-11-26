-- Abandoned card payment sweep (2026-11-26).
--
-- order.paymentSessionStartedAt: when the order's CURRENT provider session was
-- created. Written by both session writers (storefront checkout and the
-- payment-link / custom-order pay path) together with paymentSessionId.
-- NULL = unknown (orders whose session predates this column): the sweep only
-- cancels those on a definite "expired" answer from the provider.
--
-- order.paymentAbandonedAt: set by the sweep when it cancels an order whose
-- payment was never completed. NULL = not cancelled by the sweep.
--
-- Additive only, no backfill.
ALTER TABLE `order`
  ADD COLUMN `paymentSessionStartedAt` DATETIME(3) NULL,
  ADD COLUMN `paymentAbandonedAt` DATETIME(3) NULL;
