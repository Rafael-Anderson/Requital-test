-- AlterTable
ALTER TABLE `category` ADD COLUMN `image` VARCHAR(191) NULL,
    ADD COLUMN `isFeatured` BOOLEAN NOT NULL DEFAULT false;

