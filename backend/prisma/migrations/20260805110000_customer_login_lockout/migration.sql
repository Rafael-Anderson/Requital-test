-- AlterTable
-- Adds progressive login-delay tracking to `customer`, mirroring
-- 20260805090000_auth_lockout's identical columns on `user` (see
-- CustomerAuthService.login's own comment for the mechanism).
ALTER TABLE `customer` ADD COLUMN `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastFailedLoginAt` DATETIME(3) NULL;

-- Down migration (documented only — this project's migrations are forward-
-- only via `prisma migrate deploy`, which has no built-in rollback command;
-- kept here as the exact SQL an operator would run to revert by hand):
-- ALTER TABLE `customer` DROP COLUMN `failedLoginAttempts`,
--     DROP COLUMN `lastFailedLoginAt`;
