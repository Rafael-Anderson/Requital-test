-- CreateTable
CREATE TABLE `affiliate` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `mobile` VARCHAR(191) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'active',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Affiliate_shopId_fkey`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliatecode` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `affiliateId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `promotionFor` VARCHAR(191) NOT NULL DEFAULT 'All Products',
    `status` VARCHAR(191) NOT NULL DEFAULT 'approved',
    `commissionType` VARCHAR(191) NOT NULL,
    `commissionValue` DECIMAL(10, 2) NOT NULL,
    `validFrom` DATETIME(3) NULL,
    `validUntil` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AffiliateCode_shopId_code_key`(`shopId`, `code`),
    INDEX `AffiliateCode_affiliateId_fkey`(`affiliateId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `affiliateorder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `affiliateCodeId` INTEGER NOT NULL,
    `commissionAmount` DECIMAL(10, 2) NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `AffiliateOrder_orderId_key`(`orderId`),
    INDEX `AffiliateOrder_shopId_fkey`(`shopId`),
    INDEX `AffiliateOrder_affiliateCodeId_fkey`(`affiliateCodeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `affiliate` ADD CONSTRAINT `Affiliate_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `affiliatecode` ADD CONSTRAINT `AffiliateCode_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `affiliatecode` ADD CONSTRAINT `AffiliateCode_affiliateId_fkey` FOREIGN KEY (`affiliateId`) REFERENCES `affiliate`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `affiliateorder` ADD CONSTRAINT `AffiliateOrder_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `affiliateorder` ADD CONSTRAINT `AffiliateOrder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `affiliateorder` ADD CONSTRAINT `AffiliateOrder_affiliateCodeId_fkey` FOREIGN KEY (`affiliateCodeId`) REFERENCES `affiliatecode`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
