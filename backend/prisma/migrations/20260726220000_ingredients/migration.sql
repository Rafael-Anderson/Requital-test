-- CreateTable: raw materials/components tracked for stock, never sold —
-- deliberately separate from `product` (see schema.prisma's comment on the
-- `ingredient` model).
CREATE TABLE `ingredient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `unit` VARCHAR(191) NOT NULL,
    `trackInventory` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Ingredient_shopId_fkey` ON `ingredient`(`shopId`);

ALTER TABLE `ingredient` ADD CONSTRAINT `Ingredient_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: per-outlet stock for an ingredient, parallel to outletstock.
CREATE TABLE `outletingredientstock` (
    `outletId` INTEGER NOT NULL,
    `ingredientId` INTEGER NOT NULL,
    `stockQuantity` INTEGER NOT NULL DEFAULT 0,
    `lowStockThreshold` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`outletId`, `ingredientId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `OutletIngredientStock_ingredientId_fkey` ON `outletingredientstock`(`ingredientId`);

ALTER TABLE `outletingredientstock` ADD CONSTRAINT `OutletIngredientStock_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `outletingredientstock` ADD CONSTRAINT `OutletIngredientStock_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: stockmovement.productId becomes optional and a new optional
-- ingredientId is added, so one row can reference either a product or an
-- ingredient (exactly one, enforced in application code — see
-- schema.prisma's comment on the `stockmovement` model).
ALTER TABLE `stockmovement` MODIFY COLUMN `productId` INTEGER NULL;
ALTER TABLE `stockmovement` ADD COLUMN `ingredientId` INTEGER NULL;

CREATE INDEX `StockMovement_ingredientId_fkey` ON `stockmovement`(`ingredientId`);

ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
