-- STF-3: TOTP second factor for staff users and platform admins.
-- Secrets live in their OWN tables (never on user/platformadmin) so no
-- SELECT * of an account row can leak one; secretEnc is AES-GCM ciphertext
-- (common/crypto.ts), recovery codes are stored as SHA-256 only.
-- confirmedAt IS NULL = enrolment started, not active.
-- lastStep = last accepted 30s TOTP step (replay protection).
-- failedAttempts/lockedUntil = verification brute-force counter.
CREATE TABLE `usertotp` (
  `userId` INTEGER NOT NULL,
  `secretEnc` TEXT NOT NULL,
  `confirmedAt` DATETIME(3) NULL,
  `lastStep` BIGINT NULL,
  `failedAttempts` INTEGER NOT NULL DEFAULT 0,
  `lockedUntil` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`userId`),
  CONSTRAINT `usertotp_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `userrecoverycode` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `userId` INTEGER NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `userrecoverycode_userId_idx` (`userId`),
  CONSTRAINT `userrecoverycode_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `user`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platformadmintotp` (
  `platformAdminId` INTEGER NOT NULL,
  `secretEnc` TEXT NOT NULL,
  `confirmedAt` DATETIME(3) NULL,
  `lastStep` BIGINT NULL,
  `failedAttempts` INTEGER NOT NULL DEFAULT 0,
  `lockedUntil` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`platformAdminId`),
  CONSTRAINT `platformadmintotp_adminId_fkey` FOREIGN KEY (`platformAdminId`) REFERENCES `platformadmin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `platformadminrecoverycode` (
  `id` INTEGER NOT NULL AUTO_INCREMENT,
  `platformAdminId` INTEGER NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `usedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `platformadminrecoverycode_adminId_idx` (`platformAdminId`),
  CONSTRAINT `platformadminrecoverycode_adminId_fkey` FOREIGN KEY (`platformAdminId`) REFERENCES `platformadmin`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Shop-wide "require two-factor for all staff". A plain column on purpose: an
-- auth policy is not a feature flag (a platform override must not be able to
-- lower it), see CLAUDE.md "Feature flags".
ALTER TABLE `shop` ADD COLUMN `require2fa` TINYINT(1) NOT NULL DEFAULT 0;
