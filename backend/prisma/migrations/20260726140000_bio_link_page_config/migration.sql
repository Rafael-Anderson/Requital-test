-- CreateTable
CREATE TABLE `biolinkpageconfig` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `logoUrl` VARCHAR(191) NULL,
    `backgroundUrl` VARCHAR(191) NULL,
    `description` TEXT NULL,
    `metaTitle` VARCHAR(191) NULL,
    `metaDescription` TEXT NULL,

    UNIQUE INDEX `BioLinkPageConfig_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `biolinkpageconfig` ADD CONSTRAINT `BioLinkPageConfig_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
