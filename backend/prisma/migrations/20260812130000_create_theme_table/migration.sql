-- New visual theme builder ("Shopify-style" section-based homepage/header/
-- footer editor) — deliberately a separate table from the pre-existing
-- `themesettings` (see theme/theme.service.ts), not a rework of it. A shop
-- can have several saved `theme` rows (a real library, with duplicate/
-- publish/delete) but at most one `isPublished = true` at a time; MySQL has
-- no partial-unique-index equivalent to enforce that, so it's enforced
-- transactionally in ThemesService.publish() instead (unpublish-then-publish
-- inside one db.transaction).
--
-- `config` is the live draft the admin editor autosaves into. `publishedConfig`
-- is a frozen snapshot taken at publish time — this is what the storefront
-- actually renders for real (non-preview) traffic, so an in-progress edit
-- session can never leak onto the live storefront mid-edit.
--
-- Real `JSON` column type, not `LONGTEXT` — a LONGTEXT-plus-check-constraint
-- column does NOT get mysql2's automatic parse-on-read/stringify-on-write
-- (see job.payload's own documented history of this exact bug), while a real
-- `JSON` column does, matching the existing themesettings.colors/
-- shop.socialLinks/outlet.businessHours precedent.
CREATE TABLE `theme` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `isPublished` BOOLEAN NOT NULL DEFAULT false,
    `config` JSON NOT NULL,
    `publishedConfig` JSON NULL,
    `publishedAt` DATETIME(3) NULL,
    `deletedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `theme_shopId_idx` ON `theme` (`shopId`);

ALTER TABLE `theme` ADD CONSTRAINT `theme_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
