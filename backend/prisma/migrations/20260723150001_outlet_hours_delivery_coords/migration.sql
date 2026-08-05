-- AlterTable
ALTER TABLE `outlet` ADD COLUMN `businessHours` JSON NULL,
    ADD COLUMN `closedOverride` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deliveryEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `deliveryRadiusKm` DOUBLE NULL,
    ADD COLUMN `latitude` DOUBLE NULL,
    ADD COLUMN `longitude` DOUBLE NULL,
    ADD COLUMN `pickupEnabled` BOOLEAN NOT NULL DEFAULT false;
