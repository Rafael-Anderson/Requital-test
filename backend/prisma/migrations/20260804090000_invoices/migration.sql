-- Invoice & packing-slip generator: one `invoice` row per (order, type),
-- plus a per-shop-per-type sequence counter backing invoiceNumber
-- (INV-0001 / PS-0001 style, independent per shop and per type).

CREATE TABLE `invoice` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `orderId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(191) NOT NULL,
    `issuedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `subtotal` DECIMAL(65, 30) NOT NULL,
    `taxAmount` DECIMAL(65, 30) NOT NULL,
    `total` DECIMAL(65, 30) NOT NULL,
    `notes` TEXT NULL,

    UNIQUE INDEX `Invoice_orderId_type_key`(`orderId`, `type`),
    INDEX `Invoice_shopId_fkey`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

CREATE TABLE `invoicecounter` (
    `shopId` INTEGER NOT NULL,
    `type` VARCHAR(191) NOT NULL,
    `lastNumber` INTEGER NOT NULL DEFAULT 0,

    PRIMARY KEY (`shopId`, `type`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `invoice` ADD CONSTRAINT `Invoice_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `invoice` ADD CONSTRAINT `Invoice_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `invoicecounter` ADD CONSTRAINT `InvoiceCounter_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
