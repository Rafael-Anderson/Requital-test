-- CreateTable
CREATE TABLE `discount` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `code` VARCHAR(191) NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `value` DECIMAL(65, 30) NULL,
    `minPurchaseAmount` DECIMAL(65, 30) NULL,
    `appliesTo` VARCHAR(191) NOT NULL DEFAULT 'ALL_PRODUCTS',
    `usageLimit` INTEGER NULL,
    `usageLimitPerCustomer` INTEGER NULL,
    `startsAt` DATETIME(3) NULL,
    `endsAt` DATETIME(3) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `timesUsed` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Discount_shopId_code_key`(`shopId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `discount` ADD CONSTRAINT `Discount_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `discountproduct` (
    `discountId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,

    PRIMARY KEY (`discountId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DiscountProduct_productId_fkey` ON `discountproduct`(`productId`);

ALTER TABLE `discountproduct` ADD CONSTRAINT `DiscountProduct_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `discountproduct` ADD CONSTRAINT `DiscountProduct_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `discountcategory` (
    `discountId` INTEGER NOT NULL,
    `categoryId` INTEGER NOT NULL,

    PRIMARY KEY (`discountId`, `categoryId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DiscountCategory_categoryId_fkey` ON `discountcategory`(`categoryId`);

ALTER TABLE `discountcategory` ADD CONSTRAINT `DiscountCategory_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `discountcategory` ADD CONSTRAINT `DiscountCategory_categoryId_fkey` FOREIGN KEY (`categoryId`) REFERENCES `category`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable: order gets an optional discount reference + amount/code snapshot.
ALTER TABLE `order`
    ADD COLUMN `discountId` INTEGER NULL,
    ADD COLUMN `discountCode` VARCHAR(191) NULL,
    ADD COLUMN `discountAmount` DECIMAL(65, 30) NULL;

CREATE INDEX `Order_discountId_fkey` ON `order`(`discountId`);

ALTER TABLE `order` ADD CONSTRAINT `Order_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `discountredemption` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `discountId` INTEGER NOT NULL,
    `customerId` INTEGER NULL,
    `orderId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DiscountRedemption_orderId_key`(`orderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DiscountRedemption_discountId_customerId_idx` ON `discountredemption`(`discountId`, `customerId`);
CREATE INDEX `DiscountRedemption_customerId_fkey` ON `discountredemption`(`customerId`);

ALTER TABLE `discountredemption` ADD CONSTRAINT `DiscountRedemption_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `discountredemption` ADD CONSTRAINT `DiscountRedemption_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `discountredemption` ADD CONSTRAINT `DiscountRedemption_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `draftorder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `status` VARCHAR(191) NOT NULL DEFAULT 'OPEN',
    `customerId` INTEGER NULL,
    `customerName` VARCHAR(191) NOT NULL,
    `customerPhone` VARCHAR(191) NOT NULL,
    `customerEmail` VARCHAR(191) NULL,
    `customerAddress` TEXT NULL,
    `emirate` VARCHAR(191) NULL,
    `area` VARCHAR(191) NULL,
    `orderType` VARCHAR(191) NULL,
    `discountId` INTEGER NULL,
    `notes` TEXT NULL,
    `convertedOrderId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `DraftOrder_convertedOrderId_key`(`convertedOrderId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DraftOrder_shopId_fkey` ON `draftorder`(`shopId`);
CREATE INDEX `DraftOrder_outletId_fkey` ON `draftorder`(`outletId`);
CREATE INDEX `DraftOrder_customerId_fkey` ON `draftorder`(`customerId`);
CREATE INDEX `DraftOrder_discountId_fkey` ON `draftorder`(`discountId`);

ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_discountId_fkey` FOREIGN KEY (`discountId`) REFERENCES `discount`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `draftorder` ADD CONSTRAINT `DraftOrder_convertedOrderId_fkey` FOREIGN KEY (`convertedOrderId`) REFERENCES `order`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE `draftorderitem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `draftOrderId` INTEGER NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    `productName` VARCHAR(191) NOT NULL,
    `quantity` INTEGER NOT NULL,
    `price` DECIMAL(65, 30) NOT NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `DraftOrderItem_draftOrderId_fkey` ON `draftorderitem`(`draftOrderId`);
CREATE INDEX `DraftOrderItem_productId_fkey` ON `draftorderitem`(`productId`);
CREATE INDEX `DraftOrderItem_variantId_fkey` ON `draftorderitem`(`variantId`);

ALTER TABLE `draftorderitem` ADD CONSTRAINT `DraftOrderItem_draftOrderId_fkey` FOREIGN KEY (`draftOrderId`) REFERENCES `draftorder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `draftorderitem` ADD CONSTRAINT `DraftOrderItem_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `draftorderitem` ADD CONSTRAINT `DraftOrderItem_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
