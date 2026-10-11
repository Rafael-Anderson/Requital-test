-- CUS-10: customer merge record. A merge re-points everything the duplicate owns
-- at the primary and then DELETES the duplicate row, so this table is what is
-- left of it: a snapshot of the duplicate's contact fields (so "who was customer
-- 41" is answerable), what moved, who did it and when.
--
-- duplicateCustomerId is NOT a foreign key (the row is gone). UNIQUE (shopId,
-- duplicateCustomerId) makes the merge idempotent: repeating the same request
-- finds this record instead of failing. (shopId, duplicatePhone) is the alias
-- lookup that lets a later checkout under the duplicate's old phone resolve to
-- the primary instead of re-creating the duplicate. The snapshot is personal
-- data and is scrubbed when the primary is anonymised.
CREATE TABLE `customermerge` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `primaryCustomerId` INTEGER NOT NULL,
    `duplicateCustomerId` INTEGER NOT NULL,
    `duplicateName` VARCHAR(191) NULL,
    `duplicatePhone` VARCHAR(191) NULL,
    `duplicateEmail` VARCHAR(191) NULL,
    `actorUserId` INTEGER NULL,
    `moved` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customermerge_shopId_duplicateCustomerId_key`(`shopId`, `duplicateCustomerId`),
    INDEX `customermerge_shopId_duplicatePhone_idx`(`shopId`, `duplicatePhone`),
    INDEX `customermerge_primaryCustomerId_idx`(`primaryCustomerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customermerge` ADD CONSTRAINT `customermerge_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customermerge` ADD CONSTRAINT `customermerge_primaryCustomerId_fkey` FOREIGN KEY (`primaryCustomerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customermerge` ADD CONSTRAINT `customermerge_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
