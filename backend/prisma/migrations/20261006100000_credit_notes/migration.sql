-- I18N-10: credit notes. DOCUMENTS ONLY - nothing here touches an order, a
-- payment, a refund or a return amount; a credit note records a reversal that
-- the merchant has (or has not) already handled through the existing return /
-- cancellation flows.
--
-- One row per issued credit note, always against the original INVOICE (never a
-- packing slip). Everything the document prints is frozen at issue: the money
-- columns are NOT NULL because a credit note is only ever created with a
-- figure for each, and `snapshotJson` holds the rest (shop block, customer
-- block, credited lines, original invoice number) so editing the order or
-- renaming the shop later cannot rewrite a document already handed out.
--
-- Numbering reuses `invoicecounter` with type = 'CREDIT_NOTE' (CN-0001, per
-- shop). That table's `type` column is a plain VARCHAR(191) with no CHECK, so
-- no schema change is needed for the new counter row.
--
-- Real JSON type (not LONGTEXT + CHECK) so mysql2 auto-parses it; see the
-- invoice snapshot migration's note on that bug class.
CREATE TABLE `creditnote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `invoiceId` INTEGER NOT NULL,
    `number` VARCHAR(191) NOT NULL,
    `reason` VARCHAR(32) NOT NULL,
    `returnId` INTEGER NULL,
    `currency` CHAR(3) NOT NULL,
    `subtotal` DECIMAL(65, 30) NOT NULL,
    `taxAmount` DECIMAL(65, 30) NOT NULL,
    `total` DECIMAL(65, 30) NOT NULL,
    `snapshotJson` JSON NOT NULL,
    `snapshotVersion` INTEGER NOT NULL,
    `createdBy` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `creditnote_shopId_number_key`(`shopId`, `number`),
    -- A return can be credited once. Several NULLs (non-return notes) are fine.
    UNIQUE INDEX `creditnote_returnId_key`(`returnId`),
    INDEX `creditnote_orderId_idx`(`orderId`),
    INDEX `creditnote_invoiceId_idx`(`invoiceId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

-- Deleting an order/invoice cascades like every other order document does.
-- `createdBy` is SET NULL so removing a staff user never destroys the record.
ALTER TABLE `creditnote` ADD CONSTRAINT `creditnote_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `creditnote` ADD CONSTRAINT `creditnote_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `creditnote` ADD CONSTRAINT `creditnote_invoiceId_fkey` FOREIGN KEY (`invoiceId`) REFERENCES `invoice`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `creditnote` ADD CONSTRAINT `creditnote_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `orderreturn`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `creditnote` ADD CONSTRAINT `creditnote_createdBy_fkey` FOREIGN KEY (`createdBy`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
