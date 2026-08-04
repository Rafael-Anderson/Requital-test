-- Account Setup Wizard: fields collected on signup's Business/Location
-- steps that had no backing column yet (businessType and address already
-- existed on `shop`).

ALTER TABLE `shop` ADD COLUMN `trn` VARCHAR(191) NULL;
ALTER TABLE `shop` ADD COLUMN `websiteUrl` VARCHAR(191) NULL;
ALTER TABLE `shop` ADD COLUMN `operatingModel` VARCHAR(191) NULL;
ALTER TABLE `shop` ADD COLUMN `branchCount` VARCHAR(191) NULL;

ALTER TABLE `user` ADD COLUMN `phone` VARCHAR(191) NULL;
