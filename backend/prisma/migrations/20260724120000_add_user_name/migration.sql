-- Add nullable first so existing rows aren't rejected, backfill from email
-- (better than nothing for a name nobody's set yet), then tighten to NOT
-- NULL now that every row has a value.
ALTER TABLE `user` ADD COLUMN `name` VARCHAR(191) NULL;
UPDATE `user` SET `name` = SUBSTRING_INDEX(`email`, '@', 1) WHERE `name` IS NULL;
ALTER TABLE `user` MODIFY COLUMN `name` VARCHAR(191) NOT NULL;
