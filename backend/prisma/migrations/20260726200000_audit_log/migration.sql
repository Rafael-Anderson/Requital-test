-- CreateTable: scoped admin activity log (#7) — see schema.prisma comment
-- on `auditlog` for exactly what is/isn't logged and why.
CREATE TABLE `auditlog` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `actorUserId` INTEGER NOT NULL,
    `action` VARCHAR(191) NOT NULL,
    `entityType` VARCHAR(191) NOT NULL,
    `entityId` INTEGER NULL,
    `before` JSON NULL,
    `after` JSON NULL,
    `metadata` JSON NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `AuditLog_shopId_createdAt_idx` ON `auditlog`(`shopId`, `createdAt`);
CREATE INDEX `AuditLog_shopId_entityType_idx` ON `auditlog`(`shopId`, `entityType`);
CREATE INDEX `AuditLog_shopId_actorUserId_idx` ON `auditlog`(`shopId`, `actorUserId`);

ALTER TABLE `auditlog` ADD CONSTRAINT `AuditLog_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `auditlog` ADD CONSTRAINT `AuditLog_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
