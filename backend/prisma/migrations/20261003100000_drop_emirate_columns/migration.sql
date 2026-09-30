-- Phase 2b / PR-E (contract): drop the free-text `emirate` column from `order`,
-- `draftorder` and `outlet`. Every reader and writer moved to `regionId` in the
-- PRs before this one; the region's name is joined live (and frozen on invoices,
-- snapshot v2, with v1 still rendering its own frozen `emirate`).
--
-- GUARD. A column drop cannot be undone from this file, so it refuses to run while
-- any row still holds an emirate value that no region carries (emirate set,
-- regionId NULL): dropping then would lose that value for good. The guard inserts
-- a NULL into a NOT NULL column, which aborts the migration (strict mode is forced
-- below because a lax session would coerce the NULL to 0 and let the drop proceed).
-- The migration is then NOT recorded as applied, and nothing has been dropped.
-- scripts/region-backfill.ts reports exactly these rows, read-only, before this
-- runs; docs/runbook.md has the full pre-deploy procedure.
SET SESSION sql_mode = CONCAT(@@sql_mode, ',STRICT_ALL_TABLES');

DROP TEMPORARY TABLE IF EXISTS `_emirate_drop_guard`;
CREATE TEMPORARY TABLE `_emirate_drop_guard` (`unmapped` INT NOT NULL);
INSERT INTO `_emirate_drop_guard` (`unmapped`)
  SELECT NULL FROM `order` WHERE `emirate` IS NOT NULL AND `regionId` IS NULL LIMIT 1;
INSERT INTO `_emirate_drop_guard` (`unmapped`)
  SELECT NULL FROM `draftorder` WHERE `emirate` IS NOT NULL AND `regionId` IS NULL LIMIT 1;
INSERT INTO `_emirate_drop_guard` (`unmapped`)
  SELECT NULL FROM `outlet` WHERE `emirate` IS NOT NULL AND `regionId` IS NULL LIMIT 1;
DROP TEMPORARY TABLE `_emirate_drop_guard`;

ALTER TABLE `order` DROP COLUMN `emirate`;
ALTER TABLE `draftorder` DROP COLUMN `emirate`;
ALTER TABLE `outlet` DROP COLUMN `emirate`;
