-- Brands — a first-class product brand/manufacturer, replacing the free-text
-- `product.vendor` for merchants who want a real filterable entity (storefront
-- filter, admin CRUD). Shop-scoped, one catalog across all outlets same as
-- collections. `product.brandId` is nullable with ON DELETE SET NULL so deleting
-- a brand never cascades into deleting products — they just lose the brand.
CREATE TABLE `brand` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `logoUrl` VARCHAR(512) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `brand_shopId_name_key` ON `brand` (`shopId`, `name`);

ALTER TABLE `brand` ADD CONSTRAINT `brand_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `product` ADD COLUMN `brandId` INTEGER NULL;

ALTER TABLE `product` ADD CONSTRAINT `product_brandId_fkey` FOREIGN KEY (`brandId`) REFERENCES `brand`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
