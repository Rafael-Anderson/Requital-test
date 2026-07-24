-- AlterTable
ALTER TABLE `outlet` ADD COLUMN `closedOverrideSetAt` DATETIME(3) NULL,
    ADD COLUMN `deliveryZones` JSON NULL;
