-- Phase C, pass 2 of the two-way naming swap: `category` (product taxonomy
-- tree) becomes `collection`. Must run AFTER the previous migration (which
-- freed up the name "collection" by renaming the old collection to
-- `template` first) — see CLAUDE.md's Phase C note for the ordering
-- rationale. Does NOT touch `ingredientcategory` — an unrelated, separate
-- flat model for raw-materials stock tracking that only shares the
-- "category" substring by coincidence.

-- Drop FKs that will be renamed (while tables still have their old names).
ALTER TABLE `category` DROP FOREIGN KEY `Category_parentCategoryId_fkey`;
ALTER TABLE `category` DROP FOREIGN KEY `Category_shopId_fkey`;
ALTER TABLE `productcategory` DROP FOREIGN KEY `ProductCategory_productId_fkey`;
ALTER TABLE `productcategory` DROP FOREIGN KEY `ProductCategory_categoryId_fkey`;
ALTER TABLE `discountcategory` DROP FOREIGN KEY `DiscountCategory_discountId_fkey`;
ALTER TABLE `discountcategory` DROP FOREIGN KEY `DiscountCategory_categoryId_fkey`;
ALTER TABLE `biolink` DROP FOREIGN KEY `BioLink_categoryId_fkey`;

-- RenameTable
RENAME TABLE `category` TO `collection`, `productcategory` TO `productcollection`, `discountcategory` TO `discountcollection`;

-- RenameIndex (indexes survive a table rename under their old names)
ALTER TABLE `collection` RENAME INDEX `Category_shopId_slug_key` TO `Collection_shopId_slug_key`;
ALTER TABLE `collection` RENAME INDEX `Category_shopId_fkey` TO `Collection_shopId_fkey`;
ALTER TABLE `collection` RENAME INDEX `Category_parentCategoryId_fkey` TO `Collection_parentCollectionId_fkey`;
ALTER TABLE `productcollection` RENAME INDEX `ProductCategory_categoryId_fkey` TO `ProductCollection_collectionId_fkey`;
ALTER TABLE `discountcollection` RENAME INDEX `DiscountCategory_categoryId_fkey` TO `DiscountCollection_collectionId_fkey`;
ALTER TABLE `biolink` RENAME INDEX `BioLink_categoryId_fkey` TO `BioLink_collectionId_fkey`;

-- RenameColumn
ALTER TABLE `collection` CHANGE COLUMN `parentCategoryId` `parentCollectionId` INTEGER NULL;
ALTER TABLE `productcollection` CHANGE COLUMN `categoryId` `collectionId` INTEGER NOT NULL;
ALTER TABLE `discountcollection` CHANGE COLUMN `categoryId` `collectionId` INTEGER NOT NULL;
ALTER TABLE `biolink` CHANGE COLUMN `categoryId` `collectionId` INTEGER NULL;
ALTER TABLE `shop` CHANGE COLUMN `showCategoryMenu` `showCollectionMenu` BOOLEAN NOT NULL DEFAULT true;

-- Re-add FKs under their new names, pointing at the renamed table/columns.
ALTER TABLE `collection` ADD CONSTRAINT `Collection_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `collection` ADD CONSTRAINT `Collection_parentCollectionId_fkey` FOREIGN KEY (`parentCollectionId`) REFERENCES `collection`(`id`) ON DELETE NO ACTION ON UPDATE NO ACTION;
ALTER TABLE `productcollection` ADD CONSTRAINT `ProductCollection_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `productcollection` ADD CONSTRAINT `ProductCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `discountcollection` ADD CONSTRAINT `DiscountCollection_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `discountcollection` ADD CONSTRAINT `DiscountCollection_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `biolink` ADD CONSTRAINT `BioLink_collectionId_fkey` FOREIGN KEY (`collectionId`) REFERENCES `collection`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Data fixup: the old CATEGORY bio-link target type is now COLLECTION.
UPDATE `biolink` SET `type` = 'COLLECTION' WHERE `type` = 'CATEGORY';

-- Data fixup: rename the theme color JSON keys (app-level convention inside
-- a Json? column, not a real DB column) — old keys are left in place as
-- harmless orphan data, matching this project's existing tolerance for not
-- scrubbing legacy JSON keys elsewhere.
UPDATE `themesettings`
SET `colors` = JSON_SET(
  `colors`,
  '$.collectionSliderArrowColor', JSON_EXTRACT(`colors`, '$.categorySliderArrowColor'),
  '$.collectionSliderArrowActiveColor', JSON_EXTRACT(`colors`, '$.categorySliderArrowActiveColor')
)
WHERE `colors` IS NOT NULL AND JSON_CONTAINS_PATH(`colors`, 'one', '$.categorySliderArrowColor');
