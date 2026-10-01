-- P3a (W5 findings F1, F2, F9, F10, F11). Every restock and every stock delta
-- on an order used to be derived from TODAY's recipe and TODAY's flags
-- (productingredient, product.trackInventory, shop.autoDeductIngredientStock)
-- instead of from what the order actually took. This records what was taken.
--
-- `orderstockconsumption`: for one order, the NET quantity of each ingredient
-- it currently holds out of stock, per order line identity (productId +
-- variantId as the order line names them). A consume adds, a restock (cancel,
-- return, an edit that lowers a quantity) subtracts. It is written in the same
-- transaction and on the same connection as the stock decrement it describes.
-- Rows are never deleted when they reach 0: "the order has a row" is how a
-- record that has been fully released stays distinguishable from one that was
-- never written.
--
-- `order.consumptionRecordedAt`: set when an order is created (or, for a
-- pending admin order created before this migration, when it is confirmed and
-- first consumes) by code that writes the record. NULL = LEGACY: the order
-- predates the record, nothing is backfilled (what it consumed was never
-- stored, and inventing it would be a fabricated record), and it keeps the old
-- recipe-driven behaviour. Non-NULL with no rows = the order consumed nothing,
-- which is a real answer (toggle off at confirm), not "unknown".
--
-- Additive only: a new nullable column and a new table. Nothing existing is
-- read differently until application code opts an order in through the marker.
ALTER TABLE `order` ADD COLUMN `consumptionRecordedAt` DATETIME(3) NULL;

CREATE TABLE `orderstockconsumption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    -- NULLs are distinct inside a UNIQUE index, so a product-level line
    -- (variantId NULL) would never collide with itself. 0 is never a real id.
    `variantKey` INTEGER GENERATED ALWAYS AS (IFNULL(`variantId`, 0)) STORED,
    `ingredientId` INTEGER NOT NULL,
    `quantity` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `orderstockconsumption_line_key`(`orderId`, `productId`, `variantKey`, `ingredientId`),
    INDEX `orderstockconsumption_shopId_idx`(`shopId`),
    INDEX `orderstockconsumption_ingredientId_idx`(`ingredientId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `orderstockconsumption` ADD CONSTRAINT `orderstockconsumption_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `orderstockconsumption` ADD CONSTRAINT `orderstockconsumption_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `orderstockconsumption` ADD CONSTRAINT `orderstockconsumption_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- No FK on variantId: a variant deleted later must not be able to rewrite the key
-- (SET NULL would collapse it into the product-level key and could violate the
-- unique index). A stale id simply no longer matches a line; see handoff.
ALTER TABLE `orderstockconsumption` ADD CONSTRAINT `orderstockconsumption_ingredientId_fkey` FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
