-- CUS-2 tags, CUS-3 notes, CUS-11 marketing consent. Additive: six new tables,
-- nothing existing is altered.
--
-- CONSENT: UNKNOWN IS "NO ROW", never a false. customerconsent holds the CURRENT
-- state per (customer, channel) and a row exists only once somebody recorded an
-- answer: `granted` or `withdrawn`. A customer created by guest checkout, by an
-- import (S3) or by the admin has no row at all, which reads as unknown/NULL.
-- There is deliberately no boolean column on customer that could default to 0 or
-- be mistaken for a "no" (a withdrawn consent is an explicit, dated answer; an
-- absent one is not). customerconsentevent is the append-only history: every
-- change writes one row carrying the source, the wording version and the wording
-- text the customer was shown, so "what did they agree to, and when" is provable.
-- The wording TEXT is stored beside the version because the version string alone
-- stops meaning anything once the copy is edited.
--
-- The text columns are given utf8mb4_unicode_ci explicitly: a bare
-- `DEFAULT CHARACTER SET utf8mb4` resolves to MySQL 8's default collation, which
-- differs from every older table here and breaks a join on a varchar.
CREATE TABLE `customertag` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(60) NOT NULL,
    `color` VARCHAR(16) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `customertag_shopId_name_key`(`shopId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customertagassignment` (
    `customerId` INTEGER NOT NULL,
    `tagId` INTEGER NOT NULL,
    `shopId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customertagassignment_tagId_idx`(`tagId`),
    INDEX `customertagassignment_shopId_idx`(`shopId`),
    PRIMARY KEY (`customerId`, `tagId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customernote` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `authorUserId` INTEGER NULL,
    `authorName` VARCHAR(191) NOT NULL,
    `body` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customernote_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `customernote_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customerconsent` (
    `customerId` INTEGER NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `shopId` INTEGER NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `wordingVersion` VARCHAR(40) NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customerconsent_shopId_channel_status_idx`(`shopId`, `channel`, `status`),
    PRIMARY KEY (`customerId`, `channel`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `customerconsentevent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `channel` VARCHAR(16) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `source` VARCHAR(40) NOT NULL,
    `wordingVersion` VARCHAR(40) NULL,
    `wordingText` VARCHAR(1000) NULL,
    `actorUserId` INTEGER NULL,
    `note` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `customerconsentevent_customerId_createdAt_idx`(`customerId`, `createdAt`),
    INDEX `customerconsentevent_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customertag` ADD CONSTRAINT `customertag_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customertagassignment` ADD CONSTRAINT `customertagassignment_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customertagassignment` ADD CONSTRAINT `customertagassignment_tagId_fkey` FOREIGN KEY (`tagId`) REFERENCES `customertag`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customertagassignment` ADD CONSTRAINT `customertagassignment_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customernote` ADD CONSTRAINT `customernote_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customernote` ADD CONSTRAINT `customernote_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customernote` ADD CONSTRAINT `customernote_authorUserId_fkey` FOREIGN KEY (`authorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE `customerconsent` ADD CONSTRAINT `customerconsent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customerconsent` ADD CONSTRAINT `customerconsent_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customerconsentevent` ADD CONSTRAINT `customerconsentevent_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customerconsentevent` ADD CONSTRAINT `customerconsentevent_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `customerconsentevent` ADD CONSTRAINT `customerconsentevent_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;
