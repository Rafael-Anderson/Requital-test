-- Phase A: Inventory Core — make Ingredient the sole atomic stock-tracked
-- unit. Every product either auto-mirrors itself as a "shadow" ingredient
-- (usesIngredients = false, default — stock tracked directly, identical
-- merchant experience to before) or has a real recipe whose ingredient
-- stock is authoritative (usesIngredients = true). outletstock/
-- outletvariantstock are retired entirely in favor of outletingredientstock,
-- which every product/variant now resolves into via a productingredient
-- row (quantityPerUnit = 1 for a shadow, real recipe rows otherwise).
--
-- Expand -> backfill -> contract, same convention as
-- 20260723150000_merchant_auth_and_outlets (the original
-- product.stockQuantity -> outletstock move this mirrors one level up).

-- ============ Step 1: expand — new nullable/defaulted columns ============
ALTER TABLE `product`
  ADD COLUMN `usesIngredients` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `ingredient`
  ADD COLUMN `shadowProductId` INTEGER NULL,
  ADD COLUMN `shadowVariantId` INTEGER NULL;

CREATE UNIQUE INDEX `Ingredient_shadowProductId_key` ON `ingredient`(`shadowProductId`);
CREATE UNIQUE INDEX `Ingredient_shadowVariantId_key` ON `ingredient`(`shadowVariantId`);

ALTER TABLE `ingredient` ADD CONSTRAINT `Ingredient_shadowProductId_fkey`
  FOREIGN KEY (`shadowProductId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `ingredient` ADD CONSTRAINT `Ingredient_shadowVariantId_fkey`
  FOREIGN KEY (`shadowVariantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ Step 2: products that already have a REAL recipe (today's
-- pre-Phase-A, informational-only Bill of Materials feature) become
-- authoritative-recipe as-is — their existing productingredient rows are
-- untouched, no shadow is created for them. MUST run before Step 3, which
-- filters on usesIngredients = false. ============
UPDATE `product` p
SET p.`usesIngredients` = true
WHERE EXISTS (SELECT 1 FROM `productingredient` pi WHERE pi.`productId` = p.`id`);

-- ============ Step 3a: one shadow ingredient per non-variant product with
-- no real recipe. unit defaults to 'unit' — the shadow is never shown on
-- the Ingredients admin page, so the literal string is not merchant-facing.
-- ============
INSERT INTO `ingredient`
  (`shopId`, `name`, `unit`, `trackInventory`, `image`, `costPerUnit`, `shadowProductId`, `createdAt`)
SELECT p.`shopId`, p.`name`, 'unit', p.`trackInventory`, p.`thumbnail`, p.`costPrice`, p.`id`, NOW(3)
FROM `product` p
WHERE p.`usesIngredients` = false
  AND NOT EXISTS (SELECT 1 FROM `productvariant` pv WHERE pv.`productId` = p.`id`);

-- ============ Step 3b: one shadow ingredient PER VARIANT of a
-- variant-carrying product with no real recipe — never one at the product
-- level for a variant-carrying product, matching how variant stock was
-- always independent of the parent product's own stock pre-Phase-A. ============
INSERT INTO `ingredient`
  (`shopId`, `name`, `unit`, `trackInventory`, `image`, `costPerUnit`, `shadowVariantId`, `createdAt`)
SELECT p.`shopId`, p.`name`, 'unit', p.`trackInventory`, p.`thumbnail`, p.`costPrice`, pv.`id`, NOW(3)
FROM `productvariant` pv
JOIN `product` p ON p.`id` = pv.`productId`
WHERE p.`usesIngredients` = false;

-- ============ Step 4: quantityPerUnit = 1 recipe rows linking each shadow
-- back to its own product/variant — this is what makes
-- ProductsService.consumeForOrderItems / computeIngredientAvailability
-- need ZERO code changes to handle a shadow-backed product: it's simply a
-- one-ingredient recipe where quantityPerUnit is always 1 (its own units,
-- not a fraction of anything), so floor(stock / 1) = stock reproduces the
-- old outletstock number exactly. ============
INSERT INTO `productingredient` (`shopId`, `productId`, `variantId`, `ingredientId`, `quantityPerUnit`, `createdAt`, `updatedAt`)
SELECT i.`shopId`, i.`shadowProductId`, NULL, i.`id`, 1, NOW(3), NOW(3)
FROM `ingredient` i
WHERE i.`shadowProductId` IS NOT NULL;

INSERT INTO `productingredient` (`shopId`, `productId`, `variantId`, `ingredientId`, `quantityPerUnit`, `createdAt`, `updatedAt`)
SELECT i.`shopId`, pv.`productId`, i.`shadowVariantId`, i.`id`, 1, NOW(3), NOW(3)
FROM `ingredient` i
JOIN `productvariant` pv ON pv.`id` = i.`shadowVariantId`
WHERE i.`shadowVariantId` IS NOT NULL;

-- ============ Step 5: backfill outletingredientstock 1:1 from
-- outletstock/outletvariantstock (same outletId/stockQuantity/
-- lowStockThreshold, new ingredientId via the shadow join). ============
INSERT INTO `outletingredientstock` (`outletId`, `ingredientId`, `stockQuantity`, `lowStockThreshold`)
SELECT os.`outletId`, i.`id`, os.`stockQuantity`, os.`lowStockThreshold`
FROM `outletstock` os
JOIN `ingredient` i ON i.`shadowProductId` = os.`productId`;

INSERT INTO `outletingredientstock` (`outletId`, `ingredientId`, `stockQuantity`, `lowStockThreshold`)
SELECT ovs.`outletId`, i.`id`, ovs.`stockQuantity`, ovs.`lowStockThreshold`
FROM `outletvariantstock` ovs
JOIN `ingredient` i ON i.`shadowVariantId` = ovs.`variantId`;

-- ============ Step 6: contract — every reader/writer of these two tables
-- is rewritten in this same deploy (ProductsService, OrdersService,
-- PublicService, ReturnsService, LowStockDigestService, ScanService, CSV
-- import), so there is no straddling period where some code still expects
-- them. ============
DROP TABLE `outletstock`;
DROP TABLE `outletvariantstock`;
