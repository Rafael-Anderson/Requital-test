-- Automated collections. Additive only: every existing collection stays
-- 'manual' (hand-picked via productcollection) with no rules.
ALTER TABLE `collection`
  ADD COLUMN `collectionType` VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN `matchMode` VARCHAR(8) NOT NULL DEFAULT 'all';

-- One row per condition of an automated collection. shopId is carried on the
-- row (and on the FK) so a rule can never be read or evaluated across tenants.
CREATE TABLE `collectionrule` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `collectionId` INTEGER NOT NULL,
    `field` VARCHAR(32) NOT NULL,
    `operator` VARCHAR(32) NOT NULL,
    `value` VARCHAR(255) NULL,
    `position` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Collectionrule_collectionId_idx` ON `collectionrule`(`collectionId`, `position`);
CREATE INDEX `Collectionrule_shopId_idx` ON `collectionrule`(`shopId`);

ALTER TABLE `collectionrule` ADD CONSTRAINT `Collectionrule_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collectionrule` ADD CONSTRAINT `Collectionrule_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
