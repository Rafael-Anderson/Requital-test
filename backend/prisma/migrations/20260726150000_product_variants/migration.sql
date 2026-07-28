-- AlterTable: new top-level product fields (pricing/inventory/shipping/organization).
-- All nullable or defaulted so every existing product row stays valid as-is.
ALTER TABLE `product`
    ADD COLUMN `compareAtPrice` DECIMAL(65, 30) NULL,
    ADD COLUMN `barcode` VARCHAR(191) NULL,
    ADD COLUMN `continueSellingOutOfStock` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `chargeTax` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `vendor` VARCHAR(191) NULL,
    ADD COLUMN `productType` VARCHAR(191) NULL,
    ADD COLUMN `physicalProduct` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `weight` DECIMAL(65, 30) NULL,
    ADD COLUMN `weightUnit` VARCHAR(191) NOT NULL DEFAULT 'kg',
    ADD COLUMN `dimensions` VARCHAR(191) NULL;

-- CreateTable
CREATE TABLE `productimage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductImage_productId_fkey` ON `productimage`(`productId`);

ALTER TABLE `productimage` ADD CONSTRAINT `ProductImage_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `productoption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `productId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductOption_productId_fkey` ON `productoption`(`productId`);

ALTER TABLE `productoption` ADD CONSTRAINT `ProductOption_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `productoptionvalue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `optionId` INTEGER NOT NULL,
    `value` VARCHAR(191) NOT NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductOptionValue_optionId_fkey` ON `productoptionvalue`(`optionId`);

ALTER TABLE `productoptionvalue` ADD CONSTRAINT `ProductOptionValue_optionId_fkey` FOREIGN KEY (`optionId`) REFERENCES `productoption`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: productvariant was an unused stub (no sku, no options model,
-- never referenced by any service code — see schema.prisma comment) — safe
-- to drop its old columns outright rather than migrate them.
ALTER TABLE `productvariant`
    DROP COLUMN `attributes`,
    DROP COLUMN `stockQty`,
    DROP COLUMN `priceOverride`,
    ADD COLUMN `sku` VARCHAR(191) NULL,
    ADD COLUMN `barcode` VARCHAR(191) NULL,
    ADD COLUMN `price` DECIMAL(65, 30) NULL,
    ADD COLUMN `compareAtPrice` DECIMAL(65, 30) NULL,
    ADD COLUMN `weight` DECIMAL(65, 30) NULL,
    ADD COLUMN `imageId` INTEGER NULL,
    ADD COLUMN `order` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `optionValue1Id` INTEGER NULL,
    ADD COLUMN `optionValue2Id` INTEGER NULL,
    ADD COLUMN `optionValue3Id` INTEGER NULL,
    ADD COLUMN `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);

CREATE UNIQUE INDEX `ProductVariant_combination_key` ON `productvariant`(`productId`, `optionValue1Id`, `optionValue2Id`, `optionValue3Id`);
CREATE INDEX `ProductVariant_imageId_fkey` ON `productvariant`(`imageId`);
CREATE INDEX `ProductVariant_optionValue1Id_fkey` ON `productvariant`(`optionValue1Id`);
CREATE INDEX `ProductVariant_optionValue2Id_fkey` ON `productvariant`(`optionValue2Id`);
CREATE INDEX `ProductVariant_optionValue3Id_fkey` ON `productvariant`(`optionValue3Id`);

ALTER TABLE `productvariant` ADD CONSTRAINT `ProductVariant_imageId_fkey` FOREIGN KEY (`imageId`) REFERENCES `productimage`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `productvariant` ADD CONSTRAINT `ProductVariant_optionValue1Id_fkey` FOREIGN KEY (`optionValue1Id`) REFERENCES `productoptionvalue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `productvariant` ADD CONSTRAINT `ProductVariant_optionValue2Id_fkey` FOREIGN KEY (`optionValue2Id`) REFERENCES `productoptionvalue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `productvariant` ADD CONSTRAINT `ProductVariant_optionValue3Id_fkey` FOREIGN KEY (`optionValue3Id`) REFERENCES `productoptionvalue`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `outletvariantstock` (
    `outletId` INTEGER NOT NULL,
    `variantId` INTEGER NOT NULL,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `lowStockThreshold` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`outletId`, `variantId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `OutletVariantStock_variantId_fkey` ON `outletvariantstock`(`variantId`);

ALTER TABLE `outletvariantstock` ADD CONSTRAINT `OutletVariantStock_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `outletvariantstock` ADD CONSTRAINT `OutletVariantStock_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: orderitem gets an optional variant reference + label snapshot.
-- Null for every existing row and every future non-variant product order —
-- unchanged behavior.
ALTER TABLE `orderitem`
    ADD COLUMN `variantId` INTEGER NULL,
    ADD COLUMN `variantLabel` VARCHAR(191) NULL;

CREATE INDEX `OrderItem_variantId_fkey` ON `orderitem`(`variantId`);

ALTER TABLE `orderitem` ADD CONSTRAINT `OrderItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
