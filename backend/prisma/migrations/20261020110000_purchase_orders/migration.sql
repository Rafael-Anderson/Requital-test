-- INV-2: purchase orders with per-line receiving. Stacked on 20261020100000_suppliers.
--
-- ADDITIVE ONLY: no existing table is altered. Receiving posts into the
-- EXISTING stock ledger (outletingredientstock + stockmovement, new movement
-- type 'PURCHASE_RECEIPT', which is a plain VARCHAR so no column change), and
-- never touches the order consumption record (orderstockconsumption /
-- order.consumptionRecordedAt): a receipt is not an order.
--
-- Money is captured ONCE, at the event, and never recomputed:
--   purchaseorderline.unitCost/lineTotal   at the moment the line is written
--   purchaseorderreceiptline.unitCost      at the moment of receipt (the price
--                                          actually invoiced may differ from the
--                                          ordered price; both are kept)
-- Every money row carries its own currency. A PO currency is NOT NULL: a PO is a
-- priced document, and a price with no currency is the bug the multi-currency
-- work (A1) exists to prevent. It is never defaulted; creating a PO with no
-- supplier currency and no explicit one is refused by the service.
--
-- Foreign keys are chosen so history survives deletions elsewhere: a line keeps
-- its description snapshot if its ingredient/product/variant is later deleted
-- (SET NULL); supplier and outlet are RESTRICT (a supplier with POs is archived,
-- an outlet with POs is refused by OutletsService.remove).

CREATE TABLE `purchaseordercounter` (
    `shopId` INTEGER NOT NULL,
    `lastNumber` INTEGER NOT NULL,
    PRIMARY KEY (`shopId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchaseorder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    -- The RECEIVING outlet: stock lands here.
    `outletId` INTEGER NOT NULL,
    `supplierId` INTEGER NOT NULL,
    `poNumber` VARCHAR(20) NOT NULL,
    -- draft | sent | partially_received | received | cancelled. Plain VARCHAR,
    -- transitions are compare-and-swap UPDATEs in PurchaseOrdersService.
    `status` VARCHAR(30) NOT NULL DEFAULT 'draft',
    `currency` VARCHAR(3) NOT NULL,
    `subtotal` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `total` DECIMAL(65, 30) NOT NULL DEFAULT 0,
    `expectedAt` DATE NULL,
    `notes` TEXT NULL,
    `createdByUserId` INTEGER NULL,
    `sentAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `receivedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PurchaseOrder_shopId_poNumber_key`(`shopId`, `poNumber`),
    INDEX `PurchaseOrder_shopId_status_idx`(`shopId`, `status`),
    INDEX `PurchaseOrder_shopId_outletId_idx`(`shopId`, `outletId`),
    INDEX `PurchaseOrder_supplierId_idx`(`supplierId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchaseorderline` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    -- The stock-bearing target. Every product resolves to an ingredient (a plain
    -- product through its shadow), so this is always an ingredient. productId /
    -- variantId are set only for a shadow target, exactly as on stockmovement.
    `ingredientId` INTEGER NULL,
    `productId` INTEGER NULL,
    `variantId` INTEGER NULL,
    `supplierSku` VARCHAR(191) NULL,
    `description` VARCHAR(255) NOT NULL,
    `quantityOrdered` INTEGER NOT NULL,
    `quantityReceived` INTEGER NOT NULL DEFAULT 0,
    `unitCost` DECIMAL(65, 30) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `lineTotal` DECIMAL(65, 30) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrderLine_poId_idx`(`poId`),
    INDEX `PurchaseOrderLine_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchaseorderreceipt` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `poId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `receivedByUserId` INTEGER NULL,
    `deliveryNoteRef` VARCHAR(191) NULL,
    `note` TEXT NULL,
    -- Optional client key making a retried receive a no-op that returns the
    -- original receipt. NULLs are distinct in a unique index, so a receipt with
    -- no key is never constrained by it.
    `idempotencyKey` VARCHAR(64) NULL,
    `currency` VARCHAR(3) NOT NULL,
    `total` DECIMAL(65, 30) NOT NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `PurchaseOrderReceipt_poId_idempotencyKey_key`(`poId`, `idempotencyKey`),
    INDEX `PurchaseOrderReceipt_poId_idx`(`poId`),
    INDEX `PurchaseOrderReceipt_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `purchaseorderreceiptline` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `receiptId` INTEGER NOT NULL,
    `poId` INTEGER NOT NULL,
    `poLineId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `ingredientId` INTEGER NULL,
    `quantity` INTEGER NOT NULL,
    -- CAPTURED AT RECEIPT: what this delivery was costed at. Never recomputed.
    `unitCost` DECIMAL(65, 30) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `lineTotal` DECIMAL(65, 30) NOT NULL,
    -- The ledger row this receipt line posted (SET NULL if movements are ever
    -- purged with their ingredient; the receipt keeps its own record).
    `stockMovementId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `PurchaseOrderReceiptLine_receiptId_idx`(`receiptId`),
    INDEX `PurchaseOrderReceiptLine_poLineId_idx`(`poLineId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `purchaseordercounter` ADD CONSTRAINT `PurchaseOrderCounter_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `purchaseorder` ADD CONSTRAINT `PurchaseOrder_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorder` ADD CONSTRAINT `PurchaseOrder_outletId_fkey`
    FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchaseorder` ADD CONSTRAINT `PurchaseOrder_supplierId_fkey`
    FOREIGN KEY (`supplierId`) REFERENCES `supplier`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchaseorder` ADD CONSTRAINT `PurchaseOrder_createdByUserId_fkey`
    FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `purchaseorderline` ADD CONSTRAINT `PurchaseOrderLine_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `purchaseorder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderline` ADD CONSTRAINT `PurchaseOrderLine_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderline` ADD CONSTRAINT `PurchaseOrderLine_ingredientId_fkey`
    FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `purchaseorderline` ADD CONSTRAINT `PurchaseOrderLine_productId_fkey`
    FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `purchaseorderline` ADD CONSTRAINT `PurchaseOrderLine_variantId_fkey`
    FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `purchaseorderreceipt` ADD CONSTRAINT `PurchaseOrderReceipt_poId_fkey`
    FOREIGN KEY (`poId`) REFERENCES `purchaseorder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceipt` ADD CONSTRAINT `PurchaseOrderReceipt_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceipt` ADD CONSTRAINT `PurchaseOrderReceipt_outletId_fkey`
    FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceipt` ADD CONSTRAINT `PurchaseOrderReceipt_receivedByUserId_fkey`
    FOREIGN KEY (`receivedByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE `purchaseorderreceiptline` ADD CONSTRAINT `PurchaseOrderReceiptLine_receiptId_fkey`
    FOREIGN KEY (`receiptId`) REFERENCES `purchaseorderreceipt`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceiptline` ADD CONSTRAINT `PurchaseOrderReceiptLine_poLineId_fkey`
    FOREIGN KEY (`poLineId`) REFERENCES `purchaseorderline`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceiptline` ADD CONSTRAINT `PurchaseOrderReceiptLine_ingredientId_fkey`
    FOREIGN KEY (`ingredientId`) REFERENCES `ingredient`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `purchaseorderreceiptline` ADD CONSTRAINT `PurchaseOrderReceiptLine_stockMovementId_fkey`
    FOREIGN KEY (`stockMovementId`) REFERENCES `stockmovement`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
