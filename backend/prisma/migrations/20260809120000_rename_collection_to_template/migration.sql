-- Phase C, pass 1 of the two-way naming swap: OLD `collection` (curated
-- product grouping) becomes `template`. Must run BEFORE the category->
-- collection pass (next migration) so "collection" is free for category to
-- take — see CLAUDE.md's Phase C note for the full ordering rationale.

-- Drop FKs that will be renamed (while tables still have their old names).
ALTER TABLE `collectionproduct` DROP FOREIGN KEY `CollectionProduct_collectionId_fkey`;
ALTER TABLE `collectionproduct` DROP FOREIGN KEY `CollectionProduct_productId_fkey`;
ALTER TABLE `collection` DROP FOREIGN KEY `Collection_shopId_fkey`;
ALTER TABLE `biolink` DROP FOREIGN KEY `BioLink_collectionId_fkey`;

-- RenameTable
RENAME TABLE `collection` TO `template`, `collectionproduct` TO `templateproduct`;

-- RenameIndex (indexes survive a table rename under their old names)
ALTER TABLE `template` RENAME INDEX `Collection_shopId_slug_key` TO `Template_shopId_slug_key`;
ALTER TABLE `template` RENAME INDEX `Collection_shopId_fkey` TO `Template_shopId_fkey`;
ALTER TABLE `templateproduct` RENAME INDEX `CollectionProduct_productId_fkey` TO `TemplateProduct_productId_fkey`;
ALTER TABLE `biolink` RENAME INDEX `BioLink_collectionId_fkey` TO `BioLink_templateId_fkey`;

-- RenameColumn
ALTER TABLE `templateproduct` CHANGE COLUMN `collectionId` `templateId` INTEGER NOT NULL;
ALTER TABLE `biolink` CHANGE COLUMN `collectionId` `templateId` INTEGER NULL;

-- Re-add FKs under their new names, pointing at the renamed table/columns.
ALTER TABLE `template` ADD CONSTRAINT `Template_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `templateproduct` ADD CONSTRAINT `TemplateProduct_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `template`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `templateproduct` ADD CONSTRAINT `TemplateProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `biolink` ADD CONSTRAINT `BioLink_templateId_fkey` FOREIGN KEY (`templateId`) REFERENCES `template`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Data fixup: the old COLLECTION bio-link target type is now TEMPLATE.
UPDATE `biolink` SET `type` = 'TEMPLATE' WHERE `type` = 'COLLECTION';

-- Data fixup: RULE_BASED templates' old `categoryId` rule filtered by the
-- OLD category (about to become the NEW collection in the next migration),
-- so the rule key becomes `collectionId` to stay semantically accurate.
UPDATE `template`
SET `rules` = JSON_SET(JSON_REMOVE(`rules`, '$.categoryId'), '$.collectionId', JSON_EXTRACT(`rules`, '$.categoryId'))
WHERE `rules` IS NOT NULL AND JSON_CONTAINS_PATH(`rules`, 'one', '$.categoryId');
