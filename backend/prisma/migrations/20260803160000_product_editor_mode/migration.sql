-- Simple/Advanced product editor mode: shop-wide default (set on Account
-- Setup's Review step, editable in Settings > Business Information) plus a
-- per-product opt-in for Variants/Attributes/FAQs, replacing the old
-- shop-wide productVariantsEnabled/productAttributesEnabled/productFaqsEnabled
-- toggles (Store Configuration's "Catalog" card).

ALTER TABLE `shop` ADD COLUMN `productEditorMode` VARCHAR(191) NOT NULL DEFAULT 'simple';
ALTER TABLE `shop` DROP COLUMN `productVariantsEnabled`;
ALTER TABLE `shop` DROP COLUMN `productAttributesEnabled`;
ALTER TABLE `shop` DROP COLUMN `productFaqsEnabled`;

ALTER TABLE `product` ADD COLUMN `showVariants` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `product` ADD COLUMN `showAttributes` BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE `product` ADD COLUMN `showFaqs` BOOLEAN NOT NULL DEFAULT false;
