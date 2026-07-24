-- Merchant auth + multi-branch support.
--
-- Expand/contract with interleaved backfill: every existing shop gets one
-- default outlet, every existing order is attached to it, every existing
-- product's stock count is copied into the new per-outlet-stock table, and
-- only then are the old shop-wide columns dropped. Nothing is orphaned.

-- ============================================================
-- Step 1: outlet table, one default outlet per existing shop
-- ============================================================
CREATE TABLE `outlet` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `emirate` VARCHAR(191) NULL,
    `area` VARCHAR(191) NULL,
    `phone` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Outlet_shopId_fkey`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `outlet` ADD CONSTRAINT `Outlet_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- One "Main Branch" outlet per existing shop. On a fresh/empty database this
-- inserts nothing; on a populated one, every shop gets exactly one outlet to
-- migrate its orders/stock onto.
INSERT INTO `outlet` (`shopId`, `name`, `createdAt`)
SELECT `id`, 'Main Branch', NOW(3) FROM `shop`;

-- ============================================================
-- Step 2: order.outletId — add nullable, backfill, then tighten
-- ============================================================
ALTER TABLE `order` ADD COLUMN `outletId` INTEGER NULL;

-- Every existing order moves to its shop's new default outlet. Each shop has
-- exactly one outlet at this point in the migration, so the join is
-- unambiguous.
UPDATE `order` o
JOIN `outlet` ot ON ot.`shopId` = o.`shopId`
SET o.`outletId` = ot.`id`;

ALTER TABLE `order` MODIFY COLUMN `outletId` INTEGER NOT NULL;
ALTER TABLE `order` ADD CONSTRAINT `Order_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX `Order_outletId_status_idx` ON `order`(`outletId`, `status`);

-- ============================================================
-- Step 3: outletstock — create, backfill from product's current stock
-- columns, THEN drop those columns from product
-- ============================================================
CREATE TABLE `outletstock` (
    `outletId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `lowStockThreshold` INTEGER NOT NULL DEFAULT 0,

    INDEX `OutletStock_productId_fkey`(`productId`),
    PRIMARY KEY (`outletId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `outletstock` ADD CONSTRAINT `OutletStock_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `outletstock` ADD CONSTRAINT `OutletStock_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Every existing product's shop-wide stock count becomes that shop's default
-- outlet's stock count for that product.
INSERT INTO `outletstock` (`outletId`, `productId`, `stockQuantity`, `lowStockThreshold`)
SELECT ot.`id`, p.`id`, p.`stockQuantity`, p.`lowStockThreshold`
FROM `product` p
JOIN `outlet` ot ON ot.`shopId` = p.`shopId`;

ALTER TABLE `product` DROP COLUMN `lowStockThreshold`,
    DROP COLUMN `stockQuantity`;

-- ============================================================
-- Step 4: user — role/outlet/verification columns
-- ============================================================
ALTER TABLE `user` ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `outletId` INTEGER NULL,
    MODIFY `role` VARCHAR(191) NOT NULL DEFAULT 'admin';

CREATE INDEX `User_outletId_fkey` ON `user`(`outletId`);
ALTER TABLE `user` ADD CONSTRAINT `User_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
