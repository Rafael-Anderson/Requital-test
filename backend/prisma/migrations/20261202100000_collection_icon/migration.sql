-- A collection gets two images. `image` stays exactly as it is and is now the BANNER (shown only
-- on the collection's own page); `icon` is new and is what the Featured Collections circles show.
-- NULL = no icon: the storefront shows the collection's first letter, never the banner.
-- No data is rewritten. Additive only.
ALTER TABLE `collection` ADD COLUMN `icon` VARCHAR(191) NULL;
