-- Footer builder, announcement bar upgrade, and real multi-image homepage
-- banners — see the "Five related storefront features" task.

-- ============ ThemeSettings: footer description + announcement bar toggles ============
ALTER TABLE `themesettings`
  ADD COLUMN `footerDescription` TEXT NULL,
  ADD COLUMN `announcementBarEnabled` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `announcementBarScrolling` BOOLEAN NOT NULL DEFAULT false;

-- ============ CreateTable: policypage ============
CREATE TABLE `policypage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `content` TEXT NOT NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `PolicyPage_shopId_type_key`(`shopId`, `type`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `policypage` ADD CONSTRAINT `PolicyPage_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ CreateTable: bannerimage ============
CREATE TABLE `bannerimage` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `url` VARCHAR(191) NOT NULL,
    `linkUrl` VARCHAR(191) NULL,
    `order` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `BannerImage_shopId_fkey` ON `bannerimage`(`shopId`);

ALTER TABLE `bannerimage` ADD CONSTRAINT `BannerImage_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ Data migration: every existing single banner becomes the
-- first (order 0) slide, instead of being lost when the storefront switches
-- from themesettings.bannerUrl to reading the bannerimage table. ============
INSERT INTO `bannerimage` (`shopId`, `url`, `order`)
SELECT `shopId`, `bannerUrl`, 0
FROM `themesettings`
WHERE `bannerUrl` IS NOT NULL AND `bannerUrl` <> '';
