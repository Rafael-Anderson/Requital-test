-- AlterTable
ALTER TABLE `order` ADD COLUMN `paymentMethod` VARCHAR(191) NULL,
    ADD COLUMN `taxAmount` DECIMAL(65, 30) NULL;
