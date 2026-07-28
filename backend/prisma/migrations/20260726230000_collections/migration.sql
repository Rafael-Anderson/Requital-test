-- CreateTable: marketing-driven product groupings, separate from category (see schema.prisma comment).
CREATE TABLE `collection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `title` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(191) NOT NULL,
    `description` TEXT NULL,
    `image` VARCHAR(191) NULL,
    `type` VARCHAR(191) NOT NULL,
    `rules` JSON NULL,
    `isActive` BOOLEAN NOT NULL DEFAULT true,
    `displayOrder` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `Collection_shopId_slug_key` ON `collection`(`shopId`, `slug`);
CREATE INDEX `Collection_shopId_fkey` ON `collection`(`shopId`);

ALTER TABLE `collection` ADD CONSTRAINT `Collection_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: MANUAL-collection membership + manual display order.
CREATE TABLE `collectionproduct` (
    `collectionId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`collectionId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `CollectionProduct_productId_fkey` ON `collectionproduct`(`productId`);

ALTER TABLE `collectionproduct` ADD CONSTRAINT `CollectionProduct_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collectionproduct` ADD CONSTRAINT `CollectionProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: Bio Links gain a COLLECTION target option, same SetNull convention as productId/categoryId.
ALTER TABLE `biolink` ADD COLUMN `collectionId` INTEGER NULL;

CREATE INDEX `BioLink_collectionId_fkey` ON `biolink`(`collectionId`);

ALTER TABLE `biolink` ADD CONSTRAINT `BioLink_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
