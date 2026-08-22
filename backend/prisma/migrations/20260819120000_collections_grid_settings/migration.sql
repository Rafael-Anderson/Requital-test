-- Home tab "collections" mode's own grid display settings (theme builder
-- Home tab rework) -- columns/gap/title visibility/image aspect ratio,
-- read by the storefront's CollectionShowcase.tsx instead of the fixed
-- layout it used to hardcode. Small fixed string/int sets, plain columns
-- matching every other themesettings field's convention, not a SQL ENUM.
ALTER TABLE `themesettings`
  ADD COLUMN `collectionsGridColumns` INT NOT NULL DEFAULT 3,
  ADD COLUMN `collectionsGridGap` VARCHAR(191) NOT NULL DEFAULT 'md',
  ADD COLUMN `collectionsGridShowTitle` BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN `collectionsGridImageAspectRatio` VARCHAR(191) NOT NULL DEFAULT 'portrait';
