-- E1: marketplace channels framework (Deliveroo / Talabat orders arrive in
-- Requital). Additive: new tables only, nothing existing is altered, nothing is
-- backfilled. Everything ships DISABLED: `channelconnection.enabled` defaults to
-- 0 and the feature-flag registry key `marketplace_channels` defaults to false.
-- Design: docs/plans/marketplace-channels.md.
--
-- channelconnection   one row per (outlet, provider): the external ids, the
--                     encrypted credentials and webhook secret (write-only), the
--                     enabled switch and the last sync result. `routingKey` is a
--                     STORED generated column that is non-NULL only while the row
--                     is ENABLED and has a location id, with a UNIQUE index over
--                     it (the customDomainVerifiedKey pattern): an external
--                     location can be owned by exactly one enabled connection on
--                     the platform, and routing a webhook never has two answers.
--                     The three varchar columns it is built from are utf8mb4_bin
--                     so the concatenation has one collation and ids are matched
--                     exactly.
-- channelinboundevent the DURABLE INBOX. A verified delivery is written here
--                     BEFORE any processing and only then acknowledged. UNIQUE
--                     (connectionId, eventId) makes a duplicate delivery a no-op
--                     per tenant (never across tenants). `payload` is the
--                     provider's JSON body; it is purged by the sweep once
--                     processed and old (personal data), the row stays.
-- channelorder        the link between an external order and ours. UNIQUE
--                     (connectionId, externalOrderId): scoped by connection ON
--                     PURPOSE, so one tenant replaying another tenant's external
--                     order id can only collide with itself. `orderId` is NULL
--                     while the order waits for item mappings (`needs_mapping`).
--                     Commission lives here, not on `order`, so no SELECT *
--                     spread of an order can leak channel internals.
-- channelitemmapping  external item id -> product/variant, per shop and provider.
-- channelunmappeditem the queue of external items with no (valid) mapping, and
-- channelorderunmapped which waiting orders are blocked on which of them.
CREATE TABLE `channelconnection` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `provider` VARCHAR(32) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `externalLocationId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    `externalBrandId` VARCHAR(191) NULL,
    `externalSiteId` VARCHAR(191) NULL,
    `credentials` TEXT NULL,
    `webhookSecret` TEXT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `lastSyncAt` DATETIME(3) NULL,
    `lastSyncStatus` VARCHAR(16) NULL,
    `lastError` VARCHAR(500) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `routingKey` VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin
        GENERATED ALWAYS AS (
          IF(`enabled` = 1 AND `externalLocationId` IS NOT NULL,
             CONCAT(`provider`, ':', `externalLocationId`), NULL)
        ) STORED,

    UNIQUE INDEX `channelconnection_outletId_provider_key`(`outletId`, `provider`),
    UNIQUE INDEX `channelconnection_routingKey_key`(`routingKey`),
    INDEX `channelconnection_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelconnection` ADD CONSTRAINT `channelconnection_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelconnection` ADD CONSTRAINT `channelconnection_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `channelinboundevent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `connectionId` INTEGER NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `eventId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `source` VARCHAR(16) NOT NULL DEFAULT 'webhook',
    `eventType` VARCHAR(64) NULL,
    `externalOrderId` VARCHAR(191) NULL,
    `signatureVerified` BOOLEAN NOT NULL DEFAULT false,
    `payloadHash` CHAR(64) NOT NULL,
    `payload` JSON NULL,
    `payloadPurgedAt` DATETIME(3) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'received',
    `attempts` INTEGER NOT NULL DEFAULT 0,
    `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lockedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `processedAt` DATETIME(3) NULL,

    UNIQUE INDEX `channelinboundevent_connectionId_eventId_key`(`connectionId`, `eventId`),
    INDEX `channelinboundevent_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
    INDEX `channelinboundevent_shopId_receivedAt_idx`(`shopId`, `receivedAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelinboundevent` ADD CONSTRAINT `channelinboundevent_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelinboundevent` ADD CONSTRAINT `channelinboundevent_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `channelconnection`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `channelorder` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `connectionId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalOrderId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `displayId` VARCHAR(64) NULL,
    `orderId` INTEGER NULL,
    `state` VARCHAR(24) NOT NULL,
    `externalStatus` VARCHAR(32) NOT NULL,
    `acceptBy` DATETIME(3) NULL,
    `scheduledFor` DATETIME(3) NULL,
    `currency` CHAR(3) NOT NULL,
    `commissionAmount` DECIMAL(18, 3) NULL,
    `cashDueAmount` DECIMAL(18, 3) NULL,
    `priceMismatch` JSON NULL,
    `canonical` JSON NULL,
    `payloadHash` CHAR(64) NOT NULL,
    `alertedAt` DATETIME(3) NULL,
    `staleAlertedAt` DATETIME(3) NULL,
    `lastError` VARCHAR(500) NULL,
    `receivedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `channelorder_connectionId_externalOrderId_key`(`connectionId`, `externalOrderId`),
    UNIQUE INDEX `channelorder_orderId_key`(`orderId`),
    INDEX `channelorder_shopId_state_idx`(`shopId`, `state`),
    INDEX `channelorder_state_acceptBy_idx`(`state`, `acceptBy`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelorder` ADD CONSTRAINT `channelorder_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelorder` ADD CONSTRAINT `channelorder_connectionId_fkey` FOREIGN KEY (`connectionId`) REFERENCES `channelconnection`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `channelorder` ADD CONSTRAINT `channelorder_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `channelitemmapping` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalItemId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `productId` INTEGER NOT NULL,
    `variantId` INTEGER NULL,
    `externalName` VARCHAR(255) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `channelitemmapping_shopId_provider_externalItemId_key`(`shopId`, `provider`, `externalItemId`),
    INDEX `channelitemmapping_productId_idx`(`productId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelitemmapping` ADD CONSTRAINT `channelitemmapping_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelitemmapping` ADD CONSTRAINT `channelitemmapping_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `product`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelitemmapping` ADD CONSTRAINT `channelitemmapping_variantId_fkey` FOREIGN KEY (`variantId`) REFERENCES `productvariant`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `channelunmappeditem` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `provider` VARCHAR(32) NOT NULL,
    `externalItemId` VARCHAR(191) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    `externalName` VARCHAR(255) NULL,
    `occurrences` INTEGER NOT NULL DEFAULT 1,
    `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `resolvedAt` DATETIME(3) NULL,

    UNIQUE INDEX `channelunmappeditem_shopId_provider_externalItemId_key`(`shopId`, `provider`, `externalItemId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelunmappeditem` ADD CONSTRAINT `channelunmappeditem_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `channelorderunmapped` (
    `channelOrderId` INTEGER NOT NULL,
    `unmappedItemId` INTEGER NOT NULL,

    INDEX `channelorderunmapped_unmappedItemId_idx`(`unmappedItemId`),
    PRIMARY KEY (`channelOrderId`, `unmappedItemId`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `channelorderunmapped` ADD CONSTRAINT `channelorderunmapped_channelOrderId_fkey` FOREIGN KEY (`channelOrderId`) REFERENCES `channelorder`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `channelorderunmapped` ADD CONSTRAINT `channelorderunmapped_unmappedItemId_fkey` FOREIGN KEY (`unmappedItemId`) REFERENCES `channelunmappeditem`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
