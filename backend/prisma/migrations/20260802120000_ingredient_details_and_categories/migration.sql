-- Bring Ingredient closer to parity with Product: image, description, cost,
-- supplier — plus a new flat (no parent tree, unlike `category`) Ingredient
-- Category concept.

-- ============ CreateTable: ingredientcategory ============
CREATE TABLE `ingredientcategory` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `IngredientCategory_shopId_fkey` ON `ingredientcategory`(`shopId`);

ALTER TABLE `ingredientcategory` ADD CONSTRAINT `IngredientCategory_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ AlterTable: ingredient ============
ALTER TABLE `ingredient`
  ADD COLUMN `image` VARCHAR(191) NULL,
  ADD COLUMN `description` TEXT NULL,
  ADD COLUMN `costPerUnit` DECIMAL(65, 30) NULL,
  ADD COLUMN `supplier` VARCHAR(191) NULL,
  ADD COLUMN `categoryId` INTEGER NULL;

CREATE INDEX `Ingredient_categoryId_fkey` ON `ingredient`(`categoryId`);

ALTER TABLE `ingredient` ADD CONSTRAINT `Ingredient_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `ingredientcategory`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
