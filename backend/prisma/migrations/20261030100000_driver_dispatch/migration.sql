-- SHP-5: dispatch to a merchant's OWN drivers (as opposed to a Slider courier).
--
-- ADDITIVE ONLY. A driver is NOT a staff user: no login, no role, no session. It
-- reaches the system only through a per-run magic link (deliveryrunlink) that
-- stores a SHA-256 of a random secret and nothing else.
--
-- Nothing here touches order.status. A run drives the SAME order state machine
-- (OrdersService.updateStatus) the kanban uses; deliveryrunstop only records what
-- happened on the road.

CREATE TABLE `driver` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    -- Required: orders, stock and runs are all outlet-scoped, and a branch user
    -- is pinned to exactly one outlet. A driver working two outlets is two rows.
    `outletId` INTEGER NOT NULL,
    `name` VARCHAR(120) NOT NULL,
    `phone` VARCHAR(32) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `Driver_shopId_outletId_active_idx`(`shopId`, `outletId`, `active`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `driver` ADD CONSTRAINT `Driver_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `driver` ADD CONSTRAINT `Driver_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE `deliveryrun` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `driverId` INTEGER NOT NULL,
    -- draft | dispatched | in_progress | completed | cancelled (plain VARCHAR,
    -- validated in the service like every other status column here).
    `status` VARCHAR(20) NOT NULL DEFAULT 'draft',
    `runDate` DATE NULL,
    `notes` VARCHAR(500) NULL,
    -- What the driver must supply to mark a stop delivered:
    -- photo_or_otp (default) | photo | otp | none.
    `proofRequirement` VARCHAR(16) NOT NULL DEFAULT 'photo_or_otp',
    `createdByUserId` INTEGER NULL,
    `dispatchedAt` DATETIME(3) NULL,
    `completedAt` DATETIME(3) NULL,
    `cancelledAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `DeliveryRun_shopId_outletId_status_idx`(`shopId`, `outletId`, `status`),
    INDEX `DeliveryRun_driverId_idx`(`driverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `deliveryrun` ADD CONSTRAINT `DeliveryRun_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrun` ADD CONSTRAINT `DeliveryRun_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
-- RESTRICT: a driver with run history is deactivated, never deleted.
ALTER TABLE `deliveryrun` ADD CONSTRAINT `DeliveryRun_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `driver`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `deliveryrun` ADD CONSTRAINT `DeliveryRun_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE `deliveryrunstop` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `runId` INTEGER NOT NULL,
    `orderId` INTEGER NOT NULL,
    `position` INTEGER NOT NULL,
    -- pending | delivered | failed
    `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
    -- ONE ACTIVE RUN PER ORDER, enforced by the database: equals orderId while
    -- this stop is pending inside a live run, NULL once it is delivered, failed,
    -- removed from play or its run is cancelled. MySQL has no partial unique
    -- index, but a UNIQUE index treats every NULL as distinct, so this column is
    -- the partial index. Two concurrent "add to a run" calls cannot both win.
    `activeOrderId` INTEGER NULL,
    `failureReason` VARCHAR(255) NULL,
    `deliveredAt` DATETIME(3) NULL,
    `failedAt` DATETIME(3) NULL,
    -- Proof of delivery. photo | otp | both | none. The photo's storage key and
    -- URL are returned to STAFF only, never to the driver's link or any public
    -- route. The key carries 256 bits of randomness (it is a capability URL).
    `proofType` VARCHAR(8) NULL,
    `proofPhotoKey` VARCHAR(255) NULL,
    `proofPhotoUrl` VARCHAR(500) NULL,
    `proofPhotoAt` DATETIME(3) NULL,
    -- Customer one-time code. Only a salted SHA-256 is stored.
    `otpSalt` CHAR(32) NULL,
    `otpHash` CHAR(64) NULL,
    `otpExpiresAt` DATETIME(3) NULL,
    `otpAttempts` INTEGER NOT NULL DEFAULT 0,
    `otpSendCount` INTEGER NOT NULL DEFAULT 0,
    `otpSentAt` DATETIME(3) NULL,
    -- Cash on delivery. All three are NULL for a non-COD order. Amounts are in
    -- the ORDER's own captured currency (never the shop's current one).
    `codExpected` DECIMAL(65, 30) NULL,
    `cashCollectedAmount` DECIMAL(65, 30) NULL,
    `cashCurrency` CHAR(3) NULL,
    `cashDiscrepancy` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeliveryRunStop_activeOrderId_key`(`activeOrderId`),
    UNIQUE INDEX `DeliveryRunStop_runId_orderId_key`(`runId`, `orderId`),
    INDEX `DeliveryRunStop_shopId_orderId_idx`(`shopId`, `orderId`),
    INDEX `DeliveryRunStop_runId_position_idx`(`runId`, `position`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `deliveryrunstop` ADD CONSTRAINT `DeliveryRunStop_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrunstop` ADD CONSTRAINT `DeliveryRunStop_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `deliveryrun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrunstop` ADD CONSTRAINT `DeliveryRunStop_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- The magic link. One row per issued link; only the hash of the secret is kept.
CREATE TABLE `deliveryrunlink` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `runId` INTEGER NOT NULL,
    `driverId` INTEGER NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `lastUsedAt` DATETIME(3) NULL,
    `createdByUserId` INTEGER NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `DeliveryRunLink_tokenHash_key`(`tokenHash`),
    INDEX `DeliveryRunLink_runId_idx`(`runId`),
    INDEX `DeliveryRunLink_driverId_idx`(`driverId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `deliveryrunlink` ADD CONSTRAINT `DeliveryRunLink_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrunlink` ADD CONSTRAINT `DeliveryRunLink_runId_fkey` FOREIGN KEY (`runId`) REFERENCES `deliveryrun`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrunlink` ADD CONSTRAINT `DeliveryRunLink_driverId_fkey` FOREIGN KEY (`driverId`) REFERENCES `driver`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `deliveryrunlink` ADD CONSTRAINT `DeliveryRunLink_createdByUserId_fkey` FOREIGN KEY (`createdByUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- Who collected the cash on a COD order. `order.cashCollectedBy` is an FK to a
-- STAFF user; a driver is not one and is never faked as one, so a driver gets
-- its own nullable column. At most one of the two is set.
ALTER TABLE `order` ADD COLUMN `cashCollectedByDriverId` INTEGER NULL;
ALTER TABLE `order` ADD CONSTRAINT `Order_cashCollectedByDriverId_fkey` FOREIGN KEY (`cashCollectedByDriverId`) REFERENCES `driver`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The order timeline (`auditlog`) attributes every entry to a staff user. A
-- driver action is attributed by LABEL instead ("driver Ahmed"), with no user.
-- actorUserId becomes nullable; every existing row keeps its value.
ALTER TABLE `auditlog` MODIFY `actorUserId` INTEGER NULL;
ALTER TABLE `auditlog` ADD COLUMN `actorLabel` VARCHAR(191) NULL;
