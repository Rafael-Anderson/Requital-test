-- CUS-6: store credit. An APPEND-ONLY LEDGER, not a balance column: the balance
-- of a customer in a currency is SUM(amount) over their rows, so there is no
-- number that can drift from the history that explains it. The only UPDATE the
-- application ever issues against this table is the customer-merge re-pointing
-- `customerId` (customer-merge/), which keeps every row and so keeps every sum.
--
-- `currency` is NOT NULL and has no default: credit is issued in a currency and
-- only ever spent in that currency (no conversion, no silent default).
-- `amount` is signed (+ grant / spend reversal / return refund, - deduct / spend)
-- DECIMAL(14,3): exact at the finest minor unit any supported currency has (KWD,
-- BHD, OMR are 3dp) and bounded, so SUM never loses a unit.
--
-- Idempotency lives in the unique keys, not in application checks:
--   (orderId, entryType)  one spend and one spend_reversal per order (a
--                         return_refund row carries returnId, not orderId, since an
--                         order can have several returns)
--   (returnId, entryType) one return_refund per return
--   (shopId, idempotencyKey) a retried admin grant/deduct. NULLs are distinct in a
--   MySQL unique index, so the keyless rows do not collide.
-- The foreign keys to customer, order and orderreturn are RESTRICT on purpose: a
-- ledger row must never be silently removed by a delete elsewhere.
CREATE TABLE `storecreditentry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `currency` CHAR(3) NOT NULL,
    `amount` DECIMAL(14, 3) NOT NULL,
    `entryType` VARCHAR(24) NOT NULL,
    `reason` VARCHAR(500) NULL,
    `orderId` INTEGER NULL,
    `returnId` INTEGER NULL,
    `actorUserId` INTEGER NULL,
    `idempotencyKey` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `storecreditentry_orderId_entryType_key`(`orderId`, `entryType`),
    UNIQUE INDEX `storecreditentry_returnId_entryType_key`(`returnId`, `entryType`),
    UNIQUE INDEX `storecreditentry_shopId_idempotencyKey_key`(`shopId`, `idempotencyKey`),
    INDEX `storecreditentry_customerId_currency_idx`(`customerId`, `currency`),
    INDEX `storecreditentry_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `storecreditentry` ADD CONSTRAINT `storecreditentry_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `storecreditentry` ADD CONSTRAINT `storecreditentry_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `storecreditentry` ADD CONSTRAINT `storecreditentry_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `storecreditentry` ADD CONSTRAINT `storecreditentry_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `orderreturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `storecreditentry` ADD CONSTRAINT `storecreditentry_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- How much of an order was paid with store credit, mirroring giftCardAmount.
-- NULL = no store credit used (and every order that predates this). The order's
-- `total` is unchanged: credit is a payment instrument, not a price reduction.
ALTER TABLE `order` ADD COLUMN `storeCreditAmount` DECIMAL(65, 30) NULL;

-- The share of a return's refund that goes back to the customer's store credit
-- because the order was paid with it (the same proportional split as
-- giftCardRefundAmount). Whatever else a "refund to store credit" return credits
-- is the provider/manual share, derivable as refundAmount - giftCardRefundAmount
-- - storeCreditRefundAmount when refundMethod = 'store_credit'.
ALTER TABLE `orderreturn` ADD COLUMN `storeCreditRefundAmount` DECIMAL(65, 30) NOT NULL DEFAULT 0;
