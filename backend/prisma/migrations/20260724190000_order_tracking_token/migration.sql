-- AlterTable
ALTER TABLE `order` ADD COLUMN `trackingToken` VARCHAR(191) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Order_trackingToken_key` ON `order`(`trackingToken`);
