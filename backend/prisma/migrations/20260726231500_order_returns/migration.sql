-- AlterTable: charge/payment-intent id, distinct from the webhook event id
-- already stored in gatewayReference — needed to issue a real provider refund.
ALTER TABLE `paymenttransaction` ADD COLUMN `providerChargeReference` VARCHAR(191) NULL;

-- CreateTable: one row per return/refund processed against an order.
CREATE TABLE `orderreturn` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `reason` VARCHAR(191) NOT NULL,
    `refundAmount` DECIMAL(65, 30) NOT NULL,
    `refundMethod` VARCHAR(191) NOT NULL,
    `providerRefundReference` VARCHAR(191) NULL,
    `restocked` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(191) NOT NULL DEFAULT 'completed',
    `staffUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `OrderReturn_orderId_fkey` ON `orderreturn`(`orderId`);
CREATE INDEX `OrderReturn_staffUserId_fkey` ON `orderreturn`(`staffUserId`);

ALTER TABLE `orderreturn` ADD CONSTRAINT `OrderReturn_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `orderreturn` ADD CONSTRAINT `OrderReturn_staffUserId_fkey` FOREIGN KEY (`staffUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: per-line-item quantities being returned within an orderreturn.
CREATE TABLE `orderreturnitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderReturnId` INTEGER NOT NULL,
    `orderItemId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `OrderReturnItem_orderReturnId_fkey` ON `orderreturnitem`(`orderReturnId`);
CREATE INDEX `OrderReturnItem_orderItemId_fkey` ON `orderreturnitem`(`orderItemId`);

ALTER TABLE `orderreturnitem` ADD CONSTRAINT `OrderReturnItem_orderReturnId_fkey` FOREIGN KEY (`orderReturnId`) REFERENCES `orderreturn`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `orderreturnitem` ADD CONSTRAINT `OrderReturnItem_orderItemId_fkey` FOREIGN KEY (`orderItemId`) REFERENCES `orderitem`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
