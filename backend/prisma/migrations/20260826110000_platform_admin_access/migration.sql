-- Platform admin access tier: staff who manage the platform itself, not a
-- shop. Deliberately NOT rows in `user` (which is always shopId-scoped) —
-- see PlatformAdminGuard/PlatformAuthService for the separate JWT scope
-- this table backs. Mirrors `user`'s own progressive-login-lockout columns
-- (failedLoginAttempts/lastFailedLoginAt) rather than inventing a new shape.
CREATE TABLE `platformadmin` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `email` VARCHAR(255) NOT NULL,
  `passwordHash` VARCHAR(255) NOT NULL,
  `name` VARCHAR(255) NOT NULL,
  `failedLoginAttempts` INT NOT NULL DEFAULT 0,
  `lastFailedLoginAt` DATETIME(3) NULL,
  `lastLoginAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `platformadmin_email_key` (`email`)
) DEFAULT CHARACTER SET utf8mb4;

-- Every mutating platform-admin action, impersonation sessions especially.
-- shopId is nullable + ON DELETE SET NULL: a shop can (in principle) be
-- hard-deleted later without losing the rest of the audit trail entry, same
-- reasoning as auditlog's own actor/entity FKs elsewhere in this schema.
CREATE TABLE `platformauditlogentry` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `platformAdminId` INT NOT NULL,
  `action` VARCHAR(100) NOT NULL,
  `shopId` INT NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `platformauditlogentry_platformAdminId_createdAt_idx` (`platformAdminId`, `createdAt`),
  INDEX `platformauditlogentry_shopId_createdAt_idx` (`shopId`, `createdAt`),
  CONSTRAINT `platformauditlogentry_platformAdminId_fkey` FOREIGN KEY (`platformAdminId`) REFERENCES `platformadmin` (`id`),
  CONSTRAINT `platformauditlogentry_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4;

-- Reversible shop-level block: blocks merchant login (checked in
-- AuthService.login + every AuthGuard-protected request) and takes the
-- storefront offline (checked in PublicService.resolveShop, the one choke
-- point every public content-serving endpoint already routes through).
ALTER TABLE `shop`
  ADD COLUMN `suspendedAt` DATETIME(3) NULL;
