-- AlterTable
ALTER TABLE `category` ADD COLUMN `displayOrder` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `slug` VARCHAR(191) NULL;

-- Backfill slug for any pre-existing rows (dev/seed data) from name, since
-- the column can't be added NOT NULL directly on a non-empty table.
UPDATE `category`
SET `slug` = LOWER(TRIM(BOTH '-' FROM REGEXP_REPLACE(TRIM(`name`), '[^a-zA-Z0-9]+', '-')))
WHERE `slug` IS NULL;

-- AlterTable
ALTER TABLE `category` MODIFY `slug` VARCHAR(191) NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `Category_shopId_slug_key` ON `category`(`shopId`, `slug`);
