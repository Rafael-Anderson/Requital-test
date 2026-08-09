-- Phase C, new features layered on the renamed model: Templates can group
-- Collections (COLLECTION_GROUP type), the storefront gets a merchant-
-- configurable Menu (direct links + dropdowns), and the Home tab gets a
-- display-mode toggle. Purely additive — safe to run any time after the two
-- rename migrations.

-- CreateTable
CREATE TABLE `templatecollection` (
    `templateId` INTEGER NOT NULL,
    `collectionId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`templateId`, `collectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `TemplateCollection_collectionId_fkey` ON `templatecollection`(`collectionId`);

ALTER TABLE `templatecollection` ADD CONSTRAINT `TemplateCollection_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `templatecollection` ADD CONSTRAINT `TemplateCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `menuitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `label` VARCHAR(100) NOT NULL,
    `type` VARCHAR(20) NOT NULL,
    `collectionId` INTEGER NULL,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `MenuItem_shopId_fkey` ON `menuitem`(`shopId`);
CREATE INDEX `MenuItem_collectionId_fkey` ON `menuitem`(`collectionId`);

ALTER TABLE `menuitem` ADD CONSTRAINT `MenuItem_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `menuitem` ADD CONSTRAINT `MenuItem_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `menuitemcollection` (
    `menuItemId` INTEGER NOT NULL,
    `collectionId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`menuItemId`, `collectionId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `MenuItemCollection_collectionId_fkey` ON `menuitemcollection`(`collectionId`);

ALTER TABLE `menuitemcollection` ADD CONSTRAINT `MenuItemCollection_menuItemId_fkey` FOREIGN KEY (`menuItemId`) REFERENCES `menuitem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `menuitemcollection` ADD CONSTRAINT `MenuItemCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: storefront Home tab display mode ('templates' | 'collections').
ALTER TABLE `themesettings` ADD COLUMN `homeTabMode` VARCHAR(20) NOT NULL DEFAULT 'templates';
