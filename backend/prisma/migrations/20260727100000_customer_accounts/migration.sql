-- AlterTable: nullable auth fields directly on customer — null passwordHash
-- means "guest, never registered". See schema.prisma's comment on `customer`
-- for why this isn't a separate CustomerAuth model.
ALTER TABLE `customer`
  ADD COLUMN `passwordHash` VARCHAR(191) NULL,
  ADD COLUMN `emailVerified` BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN `registeredAt` DATETIME(3) NULL;

-- CreateTable: customer-facing session tokens, a separate table from
-- refreshtoken (staff) — see schema.prisma's comment on this model.
CREATE TABLE `customerrefreshtoken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `familyId` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `revokedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CustomerRefreshToken_tokenHash_key`(`tokenHash`),
    INDEX `CustomerRefreshToken_customerId_fkey`(`customerId`),
    INDEX `CustomerRefreshToken_familyId_idx`(`familyId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customerrefreshtoken` ADD CONSTRAINT `CustomerRefreshToken_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: customer password-reset tokens, a separate table from
-- authtoken (staff) — see schema.prisma's comment on this model.
CREATE TABLE `customerauthtoken` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `customerId` INTEGER NOT NULL,
    `purpose` VARCHAR(191) NOT NULL,
    `tokenHash` VARCHAR(191) NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `CustomerAuthToken_tokenHash_key`(`tokenHash`),
    INDEX `CustomerAuthToken_customerId_purpose_idx`(`customerId`, `purpose`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `customerauthtoken` ADD CONSTRAINT `CustomerAuthToken_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
