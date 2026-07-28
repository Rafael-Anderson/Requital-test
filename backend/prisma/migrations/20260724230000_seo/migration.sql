-- CreateTable
CREATE TABLE `shopseosettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `metaTitle` VARCHAR(191) NULL,
    `metaDescription` TEXT NULL,
    `ogImage` VARCHAR(191) NULL,
    `keywords` TEXT NULL,

    UNIQUE INDEX `ShopSeoSettings_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shopseosettings` ADD CONSTRAINT `ShopSeoSettings_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: product SEO fields
ALTER TABLE `product` ADD COLUMN `slug` VARCHAR(191) NULL,
    ADD COLUMN `metaTitle` VARCHAR(191) NULL,
    ADD COLUMN `metaDescription` TEXT NULL;

-- Backfill: every existing product gets a guaranteed-unique-per-shop slug
-- (the row's own id is globally unique, so trivially unique per shop too).
-- Not a pretty URL, but functionally correct — a merchant can rename it any
-- time via the admin product form, same as any auto-generated slug.
UPDATE `product` SET `slug` = CONCAT('product-', `id`) WHERE `slug` IS NULL;

ALTER TABLE `product` MODIFY COLUMN `slug` VARCHAR(191) NOT NULL;

CREATE UNIQUE INDEX `Product_shopId_slug_key` ON `product`(`shopId`, `slug`);
