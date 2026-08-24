-- Backs the cash-on-delivery completion gate: an order cannot move to
-- 'delivered' while paymentMethod = 'cash_on_delivery' and cashCollectedAt
-- is still NULL (see OrdersService.updateStatus/collectCash). Nullable,
-- no backfill — every existing order simply has no recorded collection yet.
ALTER TABLE `order`
  ADD COLUMN `cashCollectedAt` DATETIME(3) NULL,
  ADD COLUMN `cashCollectedBy` INT NULL;
