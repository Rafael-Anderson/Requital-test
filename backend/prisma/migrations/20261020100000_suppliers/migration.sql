-- INV-1: suppliers as a first-class entity (contacts, terms, per-ingredient SKU and cost).
--
-- ADDITIVE ONLY. `ingredient.supplier` and `product.vendor` stay exactly as they
-- are: they are free text the merchant typed, and nothing here guesses which
-- supplier row a given string "really" means. SuppliersService only offers a
-- read-only list of unmatched strings the merchant can promote by hand.
--
-- Unknown stays NULL, never a fabricated default: `currency`, `leadTimeDays`,
-- `minimumOrderAmount`, `unitCost` and `minOrderQty` are all nullable. In
-- particular a supplier with no currency is "currency unknown", not AED.
--
-- Money columns follow the schema convention (DECIMAL(65,30), trimmed at the API
-- boundary by trimDecimal). `minimumOrderAmount` and `supplieritem.unitCost` are
-- denominated in the row's own `currency`, never the shop's.

CREATE TABLE `supplier` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    -- active | archived. A plain VARCHAR validated in the service, like every
    -- other status column here. An archived supplier cannot be put on a new
    -- purchase order but stays readable (history keeps pointing at it).
    `status` VARCHAR(20) NOT NULL DEFAULT 'active',
    `paymentTerms` VARCHAR(255) NULL,
    `leadTimeDays` INTEGER NULL,
    `currency` VARCHAR(3) NULL,
    `minimumOrderAmount` DECIMAL(65, 30) NULL,
    `notes` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `Supplier_shopId_name_key`(`shopId`, `name`),
    INDEX `Supplier_shopId_status_idx`(`shopId`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `suppliercontact` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `supplierId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `role` VARCHAR(191) NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(50) NULL,
    -- At most one per supplier, kept by SuppliersService (a partial unique index
    -- is not expressible in MySQL), same as taxclass.isDefault.
    `isPrimary` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `SupplierContact_supplierId_idx`(`supplierId`),
    INDEX `SupplierContact_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `supplieritem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `supplierId` INTEGER NOT NULL,
    -- Every product resolves to an ingredient (a plain product through its shadow
    -- ingredient), so the supplier catalogue keys on ingredient, not product.
    `ingredientId` INTEGER NOT NULL,
    `supplierSku` VARCHAR(191) NULL,
    `unitCost` DECIMAL(65, 30) NULL,
    `currency` VARCHAR(3) NULL,
    `minOrderQty` INTEGER NULL,
    `leadTimeDays` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `SupplierItem_supplierId_ingredientId_key`(`supplierId`, `ingredientId`),
    INDEX `SupplierItem_shopId_idx`(`shopId`),
    INDEX `SupplierItem_ingredientId_idx`(`ingredientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `supplier` ADD CONSTRAINT `Supplier_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `suppliercontact` ADD CONSTRAINT `SupplierContact_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `suppliercontact` ADD CONSTRAINT `SupplierContact_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `supplieritem` ADD CONSTRAINT `SupplierItem_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `supplier`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `supplieritem` ADD CONSTRAINT `SupplierItem_ingredientId_fkey`
    FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `supplieritem` ADD CONSTRAINT `SupplierItem_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
