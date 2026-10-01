-- Payment reconciliation sweep: per-order check state.
--
-- The sweep used to pick candidates by `createdAt ASC LIMIT 50` with no memory
-- of having asked, so the 50 OLDEST unpaid-with-a-session orders in the 7-day
-- window were re-polled on every tick and a genuinely paid order behind them
-- was never reached. This table is that memory.
--
-- A separate small table, not columns on `order`: `order` is `SELECT *`-spread
-- into several responses (see attributionJson), and this is purely operational
-- bookkeeping that must never reach an API payload. One row per order that has
-- ever been checked; NO row = never checked = highest priority. No backfill:
-- existing candidates simply have no row and are treated as never checked.
--
--   lastCheckedAt  when the sweep last claimed this order for a gateway call
--                  (set BEFORE the call, by compare-and-swap, so two ticks or
--                  two processes cannot both ask)
--   settledAt      set only when the gateway reported the session EXPIRED, a
--                  terminal state for a checkout session; the sweep never
--                  asks about it again. Order/payment status are untouched.
CREATE TABLE `paymentreconciliation` (
    `orderId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `lastCheckedAt` DATETIME(3) NOT NULL,
    `settledAt` DATETIME(3) NULL,

    INDEX `paymentreconciliation_shopId_idx`(`shopId`),
    PRIMARY KEY (`orderId`)
) DEFAULT CHARACTER SET utf8mb4;

-- Deleting an order or a shop removes its check state with it.
ALTER TABLE `paymentreconciliation` ADD CONSTRAINT `paymentreconciliation_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `paymentreconciliation` ADD CONSTRAINT `paymentreconciliation_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
