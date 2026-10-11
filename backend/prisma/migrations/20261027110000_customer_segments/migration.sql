-- CUS-1: saved customer segments. A segment is a name plus a JSON RULE TREE; it
-- stores no member list. Members are computed live from the rules, which the
-- application validates against a strict schema and compiles to parameterised
-- SQL (customer-segments/segment-rules.ts). `rules` is a real JSON column, so
-- mysql2 parses it on read.
CREATE TABLE `customersegment` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `rules` JSON NOT NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customersegment_shopId_name_key`(`shopId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customersegment` ADD CONSTRAINT `customersegment_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customersegment` ADD CONSTRAINT `customersegment_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
