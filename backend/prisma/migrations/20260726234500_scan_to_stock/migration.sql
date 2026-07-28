-- CreateTable: one row per confirmed "Scan to Stock" commit — the audit
-- anchor for the source photo a batch of RECEIVED stockmovement rows came
-- from.
CREATE TABLE `scanbatch` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `imageUrl` VARCHAR(191) NOT NULL,
    `actorUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `ScanBatch_shopId_idx` ON `scanbatch`(`shopId`);
CREATE INDEX `ScanBatch_actorUserId_fkey` ON `scanbatch`(`actorUserId`);

ALTER TABLE `scanbatch` ADD CONSTRAINT `ScanBatch_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `scanbatch` ADD CONSTRAINT `ScanBatch_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: per-shop "Scan to Stock" OCR settings, one row per shop.
CREATE TABLE `scansettings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `excludeKeywords` JSON NOT NULL,
    `includeKeywords` JSON NOT NULL,
    `defaultOutletId` INTEGER NULL,
    `unmatchedBehavior` VARCHAR(191) NOT NULL DEFAULT 'ask',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `ScanSettings_shopId_key`(`shopId`),
    INDEX `ScanSettings_defaultOutletId_fkey`(`defaultOutletId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `scansettings` ADD CONSTRAINT `ScanSettings_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `scansettings` ADD CONSTRAINT `ScanSettings_defaultOutletId_fkey` FOREIGN KEY (`defaultOutletId`) REFERENCES `outlet`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable: groups RECEIVED movements produced by one scan commit under
-- their source image. Null for every other movement type.
ALTER TABLE `stockmovement` ADD COLUMN `scanBatchId` INTEGER NULL;

CREATE INDEX `StockMovement_scanBatchId_fkey` ON `stockmovement`(`scanBatchId`);

ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_scanBatchId_fkey` FOREIGN KEY (`scanBatchId`) REFERENCES `scanbatch`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
