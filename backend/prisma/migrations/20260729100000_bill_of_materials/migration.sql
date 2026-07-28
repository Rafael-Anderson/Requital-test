-- Bill of Materials: link ingredients to products (optionally per-variant),
-- and auto-deduct ingredient stock at the same points product stock is
-- already reserved/committed.

-- ============ Shop-level toggle ============
ALTER TABLE `shop`
  ADD COLUMN `autoDeductIngredientStock` BOOLEAN NOT NULL DEFAULT true;

-- ============ Order-level: was ingredient stock actually consumed for
-- this order? Read back on cancel/restock instead of re-checking the
-- toggle's *current* value, so flipping the toggle mid-order-lifecycle
-- can't cause a restock that was never deducted (or skip one that was).
-- ============
ALTER TABLE `order`
  ADD COLUMN `ingredientsConsumedAt` DATETIME(3) NULL;

-- ============ stockmovement.actorUserId becomes nullable: CONSUMED
-- (Bill of Materials auto-deduction) is the first movement type that can
-- fire with no authenticated staff user at all (anonymous storefront
-- checkout) — see stockmovement's schema comment. Every existing row
-- already has a real actorUserId and is untouched by this relax. ============
ALTER TABLE `stockmovement` MODIFY COLUMN `actorUserId` INTEGER NULL;

-- ============ CreateTable: productingredient ============
CREATE TABLE `productingredient` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    `ingredientId` INTEGER NOT NULL,
    `quantityPerUnit` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ProductIngredient_product_variant_ingredient_key`(`productId`, `variantId`, `ingredientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ProductIngredient_shopId_fkey` ON `productingredient`(`shopId`);
CREATE INDEX `ProductIngredient_variantId_fkey` ON `productingredient`(`variantId`);
CREATE INDEX `ProductIngredient_ingredientId_fkey` ON `productingredient`(`ingredientId`);

ALTER TABLE `productingredient` ADD CONSTRAINT `ProductIngredient_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `productingredient` ADD CONSTRAINT `ProductIngredient_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `productingredient` ADD CONSTRAINT `ProductIngredient_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `productingredient` ADD CONSTRAINT `ProductIngredient_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
