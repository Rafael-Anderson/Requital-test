-- AlterTable
ALTER TABLE `order` ADD COLUMN `area` VARCHAR(191) NULL,
    ADD COLUMN `customerAddress` TEXT NOT NULL,
    ADD COLUMN `customerName` VARCHAR(191) NOT NULL,
    ADD COLUMN `customerPhone` VARCHAR(191) NOT NULL,
    ADD COLUMN `deliveryDate` DATETIME(3) NULL,
    ADD COLUMN `deliveryTimeSlot` VARCHAR(191) NULL,
    ADD COLUMN `emirate` VARCHAR(191) NOT NULL,
    ADD COLUMN `paymentLinkExpiresAt` DATETIME(3) NULL,
    ADD COLUMN `paymentLinkToken` VARCHAR(191) NULL,
    MODIFY `customerEmail` VARCHAR(191) NULL,
    MODIFY `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    MODIFY `paymentStatus` VARCHAR(191) NOT NULL DEFAULT 'unpaid';

-- AlterTable
ALTER TABLE `orderitem` DROP COLUMN `productVariantId`,
    ADD COLUMN `productId` INTEGER NOT NULL,
    ADD COLUMN `productName` VARCHAR(191) NOT NULL;

-- AlterTable
ALTER TABLE `product` ADD COLUMN `lowStockThreshold` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `trackInventory` BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX `Order_paymentLinkToken_key` ON `order`(`paymentLinkToken`);

-- CreateIndex
CREATE INDEX `Order_shopId_status_idx` ON `order`(`shopId`, `status`);

-- CreateIndex
CREATE INDEX `Order_shopId_createdAt_idx` ON `order`(`shopId`, `createdAt`);

-- CreateIndex
CREATE INDEX `OrderItem_productId_fkey` ON `orderitem`(`productId`);

-- AddForeignKey
ALTER TABLE `orderitem` ADD CONSTRAINT `OrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

