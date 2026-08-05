-- AlterTable
ALTER TABLE `user` ADD COLUMN `failedLoginAttempts` INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN `lastFailedLoginAt` DATETIME(3) NULL;
