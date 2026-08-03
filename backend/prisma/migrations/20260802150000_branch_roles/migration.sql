-- Branch-specific roles: a per-(user, outlet) permission override layered
-- on top of the existing shop-wide 4-tier user.role, not replacing it. See
-- common/permissions.ts for the fixed permission vocabulary and the
-- restrict-only intersection that is the actual security guarantee.

-- ============ CreateTable: branchrole ============
CREATE TABLE `branchrole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `permissions` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `BranchRole_shopId_fkey` ON `branchrole`(`shopId`);
CREATE UNIQUE INDEX `BranchRole_shopId_name_key` ON `branchrole`(`shopId`, `name`);

ALTER TABLE `branchrole` ADD CONSTRAINT `BranchRole_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ============ CreateTable: useroutletrole ============
CREATE TABLE `useroutletrole` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `userId` INTEGER NOT NULL,
    `outletId` INTEGER NOT NULL,
    `branchRoleId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE UNIQUE INDEX `UserOutletRole_userId_outletId_key` ON `useroutletrole`(`userId`, `outletId`);
CREATE INDEX `UserOutletRole_outletId_fkey` ON `useroutletrole`(`outletId`);
CREATE INDEX `UserOutletRole_branchRoleId_fkey` ON `useroutletrole`(`branchRoleId`);

ALTER TABLE `useroutletrole` ADD CONSTRAINT `UserOutletRole_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `useroutletrole` ADD CONSTRAINT `UserOutletRole_outletId_fkey` FOREIGN KEY (`outletId`) REFERENCES `outlet`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `useroutletrole` ADD CONSTRAINT `UserOutletRole_branchRoleId_fkey` FOREIGN KEY (`branchRoleId`) REFERENCES `branchrole`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
