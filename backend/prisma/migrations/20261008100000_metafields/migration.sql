-- CAT-1: metafields. A shop-defined, typed custom field that can hang off a
-- product, variant, collection, customer, order or outlet. This migration is
-- the mechanism only; there are no seeded definitions (vertical packs are a
-- later phase).
--
-- Column naming: the brief called the definition's identifier `key`, but KEY
-- is a MySQL reserved word. It is `fieldKey` here (the API still calls it
-- `key`), so no statement anywhere has to remember a backtick.
--
-- `metafieldvalue.ownerId` is polymorphic (it points into one of six tables
-- chosen by `ownerType`), so it carries no FK. Two consequences, both handled
-- in application code and documented in docs/handoff/wa.md: the owner's
-- shop is verified on every write (the IDOR guard), and an owner's values are
-- deleted when the owner is deleted or anonymised.
--
-- `value` is a real JSON column (not LONGTEXT + CHECK), so mysql2 auto-parses
-- it. NOT NULL: "no value" is the absence of a row, never a stored NULL.
CREATE TABLE `metafielddefinition` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `ownerType` ENUM('product', 'variant', 'collection', 'customer', 'order', 'outlet') NOT NULL,
    `namespace` VARCHAR(40) NOT NULL,
    `fieldKey` VARCHAR(40) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `validationJson` JSON NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `visibleOnStorefront` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `metafielddefinition_identity_key`(`shopId`, `ownerType`, `namespace`, `fieldKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `metafieldvalue` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `ownerType` ENUM('product', 'variant', 'collection', 'customer', 'order', 'outlet') NOT NULL,
    `ownerId` INTEGER NOT NULL,
    `definitionId` INTEGER NOT NULL,
    `value` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `metafieldvalue_owner_definition_key`(`ownerType`, `ownerId`, `definitionId`),
    INDEX `metafieldvalue_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `metafielddefinition` ADD CONSTRAINT `metafielddefinition_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `metafieldvalue` ADD CONSTRAINT `metafieldvalue_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
-- Backstop only: the service refuses to delete a definition that still has
-- values unless the caller asks for them to go in the same transaction.
ALTER TABLE `metafieldvalue` ADD CONSTRAINT `metafieldvalue_definitionId_fkey` FOREIGN KEY (`definitionId`) REFERENCES `metafielddefinition`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
