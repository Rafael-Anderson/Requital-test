-- PLT-11 / audit 6-F: a per-shop feature override, set only by Requital staff.
--
-- Precedence the resolver applies (backend/src/features/features.service.ts):
--   platform override row -> the existing shop column (column-backed keys only)
--   -> plan default (no billing yet, always undefined) -> registry default.
-- Additive. No existing shop column is touched, no row is backfilled: with no
-- rows in this table every shop resolves to exactly what its column says today.
--
-- `featureKey`, not `key`: KEY is a reserved word in MySQL.
-- `updatedBy` is a platformadmin id (NULL once that admin row is gone), never a
-- merchant user: a shop admin has no write path to this table at all.
CREATE TABLE `shopfeatureoverride` (
  `shopId` INT NOT NULL,
  `featureKey` VARCHAR(64) NOT NULL,
  `enabled` BOOLEAN NOT NULL,
  `note` VARCHAR(500) NULL,
  `updatedBy` INT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`shopId`, `featureKey`),
  CONSTRAINT `shopfeatureoverride_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE,
  CONSTRAINT `shopfeatureoverride_updatedBy_fkey` FOREIGN KEY (`updatedBy`) REFERENCES `platformadmin` (`id`) ON DELETE SET NULL
) DEFAULT CHARACTER SET utf8mb4;
