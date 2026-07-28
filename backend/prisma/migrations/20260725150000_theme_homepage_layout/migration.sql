-- NOT NULL with a DEFAULT: MySQL backfills every existing row with
-- 'classic' in the same statement, no separate UPDATE needed (unlike
-- product.slug's per-row-unique backfill in an earlier migration).
ALTER TABLE `themesettings` ADD COLUMN `homepageLayout` VARCHAR(191) NOT NULL DEFAULT 'classic';
