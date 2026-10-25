-- Phone OTP for customer register-claim (behind the phone_otp_register feature
-- flag, default off). One row per code sent, keyed by shop + E.164 phone, NOT by
-- customer: the person proving a number often has no customer row yet. codeHash is
-- an HMAC (never the code). attempts is bumped atomically before the compare;
-- consumedAt is the compare-and-swap that makes a code single use. Verifying a code
-- stores the hash of an opaque proof token (proofHash) bound to this shop + phone;
-- registering spends it (proofUsedAt, another compare-and-swap). Additive.
CREATE TABLE `phoneotp` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `phone` VARCHAR(32) NOT NULL,
  `codeHash` CHAR(64) NOT NULL,
  `attempts` INT NOT NULL DEFAULT 0,
  `expiresAt` DATETIME(3) NOT NULL,
  `consumedAt` DATETIME(3) NULL,
  `proofHash` CHAR(64) NULL,
  `proofExpiresAt` DATETIME(3) NULL,
  `proofUsedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `phoneotp_proofHash_key`(`proofHash`),
  INDEX `phoneotp_shopId_phone_createdAt_idx`(`shopId`, `phone`, `createdAt`),
  INDEX `phoneotp_createdAt_idx`(`createdAt`),
  CONSTRAINT `phoneotp_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- When the account holder last proved control of the phone (NULL = never; no
-- backfill, nothing recorded it before).
ALTER TABLE `customer` ADD COLUMN `phoneVerifiedAt` DATETIME(3) NULL;
