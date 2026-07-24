-- AlterTable
ALTER TABLE `shop` ADD COLUMN `deliveryPaymentCardOnline` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `deliveryPaymentCashOnDelivery` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `deliveryPaymentCardOnDelivery` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `pickupPaymentCardOnline` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pickupPaymentCashOnPickup` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `pickupPaymentCardOnPickup` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deliveryHours` JSON NULL,
    ADD COLUMN `pickupHours` JSON NULL,
    ADD COLUMN `deliveryTimeSlotGapMinutes` INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN `deliveryPreparationTimeMinutes` INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN `deliveryPreparationPlusDeliveryTimeMinutes` INTEGER NOT NULL DEFAULT 45,
    ADD COLUMN `estimatedDeliveryTimeFrom` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `estimatedDeliveryTimeTo` INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN `estimatedDeliveryTimeUnit` VARCHAR(191) NOT NULL DEFAULT 'minutes',
    ADD COLUMN `pickupTimeSlotGapMinutes` INTEGER NOT NULL DEFAULT 30,
    ADD COLUMN `pickupPreparationTimeMinutes` INTEGER NOT NULL DEFAULT 15,
    ADD COLUMN `pickupPreparationPlusTimeMinutes` INTEGER NOT NULL DEFAULT 30;

-- AlterTable
ALTER TABLE `outlet` DROP COLUMN `deliveryZones`;

-- CreateTable
CREATE TABLE `deliveryzone` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `outletId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `fee` DECIMAL(65, 30) NOT NULL,
    `minOrderAmount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryZone_outletId_fkey`(`outletId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `deliveryzone` ADD CONSTRAINT `DeliveryZone_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
