-- AlterTable
ALTER TABLE `order` ADD COLUMN `channel` VARCHAR(191) NULL,
    ADD COLUMN `deliveryNotes` TEXT NULL,
    ADD COLUMN `orderType` VARCHAR(191) NULL,
    ADD COLUMN `receiverMessage` TEXT NULL;

