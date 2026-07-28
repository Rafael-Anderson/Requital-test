-- Widen: VARCHAR(191) -> TEXT. A widen never loses data, no backfill needed.
ALTER TABLE `product` MODIFY COLUMN `description` TEXT NULL;
ALTER TABLE `product` MODIFY COLUMN `shortSummary` TEXT NULL;
ALTER TABLE `product` MODIFY COLUMN `longSummary` TEXT NULL;

-- Backing field for the platform sitemap's lastmod value (see
-- PublicService.listShopsForSitemap). Existing rows get their createdAt as
-- a reasonable initial "last updated" value; every write from here on
-- updates it automatically (Prisma's @updatedAt).
ALTER TABLE `shop` ADD COLUMN `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3);
UPDATE `shop` SET `updatedAt` = `createdAt`;
