-- CreateTable: one shared chronological log for both inventory transfers
-- (#6) and reason-coded stock adjustments (#10) — see the schema.prisma
-- comment on `stockmovement` for why these share a table instead of two.
CREATE TABLE `stockmovement` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    `type` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(191) NULL,
    `delta` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `toOutletId` INTEGER NULL,
    `note` TEXT NULL,
    `actorUserId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `StockMovement_shopId_productId_idx` ON `stockmovement`(`shopId`, `productId`);
CREATE INDEX `StockMovement_shopId_createdAt_idx` ON `stockmovement`(`shopId`, `createdAt`);
CREATE INDEX `StockMovement_variantId_fkey` ON `stockmovement`(`variantId`);
CREATE INDEX `StockMovement_outletId_fkey` ON `stockmovement`(`outletId`);
CREATE INDEX `StockMovement_toOutletId_fkey` ON `stockmovement`(`toOutletId`);
CREATE INDEX `StockMovement_actorUserId_fkey` ON `stockmovement`(`actorUserId`);

ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_toOutletId_fkey` FOREIGN KEY (`toOutletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `stockmovement` ADD CONSTRAINT `StockMovement_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
