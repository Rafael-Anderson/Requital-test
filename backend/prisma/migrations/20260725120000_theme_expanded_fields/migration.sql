ALTER TABLE `themesettings`
    ADD COLUMN `footerLogoUrl` VARCHAR(191) NULL,
    ADD COLUMN `notificationText` JSON NULL,
    ADD COLUMN `contactNumbers` JSON NULL,
    ADD COLUMN `colors` JSON NULL;
