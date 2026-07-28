-- Abandoned Cart Recovery, Low Stock Alerts, Gift Cards — one batched
-- migration for three independent features landing together.

-- ============ Shop-level toggles/config ============
ALTER TABLE `shop`
  ADD COLUMN `notifyAbandonedCart` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `abandonedCartWindowMinutes` INTEGER NOT NULL DEFAULT 60,
  ADD COLUMN `notifyLowStockDigest` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `lowStockDigestLastSentAt` DATETIME(3) NULL;

-- ============ Low Stock Alerts: lowStockThreshold becomes a real,
-- merchant-settable, off-by-default field instead of a dead always-0
-- column. Relax the constraint first, THEN backfill every existing 0 (the
-- only value any row could ever have — there was no write path to set
-- anything else) to NULL, so the feature ships as "off for every shop"
-- until a merchant explicitly sets a threshold, not "alerting on every
-- product currently at/below zero stock." ============
ALTER TABLE `outletstock` MODIFY COLUMN `lowStockThreshold` INTEGER NULL;
UPDATE `outletstock` SET `lowStockThreshold` = NULL WHERE `lowStockThreshold` = 0;

ALTER TABLE `outletvariantstock` MODIFY COLUMN `lowStockThreshold` INTEGER NULL;
UPDATE `outletvariantstock` SET `lowStockThreshold` = NULL WHERE `lowStockThreshold` = 0;

ALTER TABLE `outletingredientstock` MODIFY COLUMN `lowStockThreshold` INTEGER NULL;
UPDATE `outletingredientstock` SET `lowStockThreshold` = NULL WHERE `lowStockThreshold` = 0;

-- ============ Gift Cards: product-as-gift-card config ============
ALTER TABLE `product`
  ADD COLUMN `isGiftCard` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `giftCardDenominations` JSON NULL,
  ADD COLUMN `giftCardCustomAmountMin` DECIMAL(65, 30) NULL,
  ADD COLUMN `giftCardCustomAmountMax` DECIMAL(65, 30) NULL;

-- ============ Gift Cards: order-level snapshot of what was applied,
-- same shape as the existing discountId/discountCode/discountAmount trio
-- ============
ALTER TABLE `order`
  ADD COLUMN `giftCardId` INTEGER NULL,
  ADD COLUMN `giftCardCode` VARCHAR(191) NULL,
  ADD COLUMN `giftCardAmount` DECIMAL(65, 30) NULL;

CREATE INDEX `Order_giftCardId_fkey` ON `order`(`giftCardId`);

-- ============ Gift Cards: refund-back-to-balance tracking on returns
-- ============
ALTER TABLE `orderreturn`
  ADD COLUMN `giftCardRefundAmount` DECIMAL(65, 30) NOT NULL DEFAULT 0;

-- ============ CreateTable: giftcard ============
CREATE TABLE `giftcard` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `initialValue` DECIMAL(65, 30) NOT NULL,
    `remainingBalance` DECIMAL(65, 30) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `expiresAt` DATETIME(3) NULL,
    `purchasedByCustomerId` INTEGER NULL,
    `purchaseOrderId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `GiftCard_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `GiftCard_shopId_fkey` ON `giftcard`(`shopId`);
CREATE INDEX `GiftCard_purchasedByCustomerId_fkey` ON `giftcard`(`purchasedByCustomerId`);
CREATE INDEX `GiftCard_purchaseOrderId_fkey` ON `giftcard`(`purchaseOrderId`);

ALTER TABLE `giftcard` ADD CONSTRAINT `GiftCard_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `giftcard` ADD CONSTRAINT `GiftCard_purchasedByCustomerId_fkey` FOREIGN KEY (`purchasedByCustomerId`) REFERENCES `customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `giftcard` ADD CONSTRAINT `GiftCard_purchaseOrderId_fkey` FOREIGN KEY (`purchaseOrderId`) REFERENCES `order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `order` ADD CONSTRAINT `Order_giftCardId_fkey` FOREIGN KEY (`giftCardId`) REFERENCES `giftcard`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ============ CreateTable: giftcardredemption ============
CREATE TABLE `giftcardredemption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `giftCardId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `amountUsed` DECIMAL(65, 30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `GiftCardRedemption_giftCardId_fkey` ON `giftcardredemption`(`giftCardId`);
CREATE INDEX `GiftCardRedemption_orderId_fkey` ON `giftcardredemption`(`orderId`);

ALTER TABLE `giftcardredemption` ADD CONSTRAINT `GiftCardRedemption_giftCardId_fkey` FOREIGN KEY (`giftCardId`) REFERENCES `giftcard`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `giftcardredemption` ADD CONSTRAINT `GiftCardRedemption_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ CreateTable: abandonedcart ============
CREATE TABLE `abandonedcart` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `outletId` INTEGER NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NOT NULL,
    `customerEmail` VARCHAR(191) NULL,
    `cartItems` JSON NOT NULL,
    `cartValue` DECIMAL(65, 30) NOT NULL,
    `capturedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    `recoverToken` VARCHAR(191) NOT NULL,
    `recoveryEmailSentAt` DATETIME(3) NULL,
    `recoveredOrderId` INTEGER NULL,

    UNIQUE INDEX `AbandonedCart_recoverToken_key`(`recoverToken`),
    UNIQUE INDEX `AbandonedCart_recoveredOrderId_key`(`recoveredOrderId`),
    UNIQUE INDEX `AbandonedCart_shopId_customerPhone_key`(`shopId`, `customerPhone`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `AbandonedCart_shopId_fkey` ON `abandonedcart`(`shopId`);
CREATE INDEX `AbandonedCart_outletId_fkey` ON `abandonedcart`(`outletId`);

ALTER TABLE `abandonedcart` ADD CONSTRAINT `AbandonedCart_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `abandonedcart` ADD CONSTRAINT `AbandonedCart_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `abandonedcart` ADD CONSTRAINT `AbandonedCart_recoveredOrderId_fkey` FOREIGN KEY (`recoveredOrderId`) REFERENCES `order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
