-- MKT-3: per-shop email SENDING DOMAIN (a merchant's own domain for From).
--
-- One row per shop (UNIQUE shopId). The merchant adds the DNS records the email
-- provider returns (stored in recordsJson, public DNS values only, no secret);
-- the row becomes 'verified' when the provider reports it so. Mail is sent from
-- the shop's domain ONLY while status = 'verified'; otherwise the platform
-- address is used (see common/email.ts).
--
-- Same exclusivity idea as shop.customDomainVerifiedKey: a STORED generated
-- column that is NULL unless verified, plus a UNIQUE index over it, so two shops
-- can hold a pending claim on one hostname but only one can ever be verified
-- for it (SQL NULLs never collide). Additive only.
CREATE TABLE `shopsendingdomain` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `domain` VARCHAR(253) NOT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'pending',
  `providerDomainId` VARCHAR(191) NULL,
  `recordsJson` JSON NULL,
  `lastError` VARCHAR(255) NULL,
  `claimedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastCheckedAt` DATETIME(3) NULL,
  `verifiedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `verifiedKey` VARCHAR(253)
    GENERATED ALWAYS AS (IF(`status` = 'verified', `domain`, NULL)) STORED,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `shopsendingdomain_shopId_key` (`shopId`),
  UNIQUE INDEX `shopsendingdomain_verifiedKey_key` (`verifiedKey`),
  INDEX `shopsendingdomain_sweep_idx` (`status`, `lastCheckedAt`),
  CONSTRAINT `shopsendingdomain_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
