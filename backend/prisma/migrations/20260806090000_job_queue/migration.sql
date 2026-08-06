-- Phase 5 — DB-backed job queue + scheduler advisory lock. See JobsService /
-- SchedulerService and the schema.prisma comments on `job` / `scheduledjoblock`.

CREATE TABLE `job` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `type` VARCHAR(191) NOT NULL,
  `payload` JSON NOT NULL,
  `idempotencyKey` VARCHAR(191) NOT NULL,
  `status` VARCHAR(191) NOT NULL DEFAULT 'pending',
  `attempts` INT NOT NULL DEFAULT 0,
  `maxAttempts` INT NOT NULL DEFAULT 5,
  `nextAttemptAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastError` TEXT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  `completedAt` DATETIME(3) NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `Job_idempotencyKey_key`(`idempotencyKey`),
  INDEX `Job_status_nextAttemptAt_idx`(`status`, `nextAttemptAt`),
  INDEX `Job_shopId_fkey`(`shopId`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `job` ADD CONSTRAINT `Job_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `scheduledjoblock` (
  `name` VARCHAR(191) NOT NULL,
  `lockedUntil` DATETIME(3) NULL,
  PRIMARY KEY (`name`)
) DEFAULT CHARACTER SET utf8mb4;
