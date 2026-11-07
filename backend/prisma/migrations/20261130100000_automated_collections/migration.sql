-- Automated collections (Shopify-style conditions). Additive only.
--
-- collection.collectionType: 'manual' (the existing behaviour, the default for every
-- existing row: products are assigned through productcollection) or 'automated' (the
-- member products are computed at read time from collectionrule rows).
-- collection.matchMode: 'all' (every condition) or 'any' (at least one); only used
-- by automated collections.
-- collectionrule: one condition per row. field/operator are validated against a strict
-- allowlist in the application (collections/collection-rules.ts); value is a string
-- (numbers and money are kept as decimal strings and compared with CAST(? AS DECIMAL),
-- never as floats). A rule belongs to a collection of the same shop (shopId is
-- repeated here so every query can be tenant-scoped without a join).

ALTER TABLE `collection`
  ADD COLUMN `collectionType` VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN `matchMode` VARCHAR(8) NOT NULL DEFAULT 'all';

CREATE TABLE `collectionrule` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `shopId` INTEGER NOT NULL,
  `collectionId` INTEGER NOT NULL,
  `position` INTEGER NOT NULL DEFAULT 0,
  `field` VARCHAR(32) NOT NULL,
  `operator` VARCHAR(16) NOT NULL,
  `value` VARCHAR(255) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `collectionrule_collectionId_idx` (`collectionId`, `position`),
  INDEX `collectionrule_shopId_idx` (`shopId`),
  CONSTRAINT `collectionrule_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection` (`id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `collectionrule_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
