-- MKT-1: consent-gated email CAMPAIGNS. Additive: three new tables, three nullable
-- columns on newslettersubscriber, one planfeature insert. Nothing is backfilled.
--
-- CONSENT RULE (the whole point of this migration's shape): a campaign goes only to
-- an address with a RECORDED grant. Unknown is never a yes.
--   * a customer qualifies only through a customerconsent row (channel 'email',
--     status 'granted'); no row = unknown = excluded;
--   * a newsletter subscriber qualifies only once `confirmedAt` is set, by the
--     double opt-in link mailed to the address. EVERY EXISTING ROW STAYS
--     UNCONFIRMED (confirmedAt NULL, no backfill): the widget never recorded what
--     the visitor agreed to, so an old row proves nothing. Owner decision.
-- emailsuppression is the do-not-contact list; it is subtracted from every audience.
--
-- campaignrecipient is the frozen audience (one row per address, UNIQUE per
-- campaign so a retried confirm cannot enqueue anyone twice). `unsubTokenHash` is
-- the SHA-256 of an opaque 128-bit token that exists in clear only inside the one
-- email it was sent in; `email` is NULLable so PDPL anonymisation can scrub it and
-- keep the counts. `claimedAt` is the at-most-once claim: a row is claimed by a CAS
-- BEFORE the send, so a crash never produces a second copy.
--
-- Text columns carry utf8mb4_unicode_ci explicitly (as the CRM tables do) so joins
-- on email against customer / newslettersubscriber compare under one collation.
ALTER TABLE `newslettersubscriber`
  ADD COLUMN `confirmedAt` DATETIME(3) NULL,
  ADD COLUMN `confirmTokenHash` CHAR(64) NULL,
  ADD COLUMN `confirmSentAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `newslettersubscriber_confirmTokenHash_key` (`confirmTokenHash`);

CREATE TABLE `campaign` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `name` VARCHAR(120) NOT NULL,
  `subject` VARCHAR(200) NOT NULL,
  `bodyHtml` MEDIUMTEXT NOT NULL,
  `segmentId` INT NULL,
  `status` VARCHAR(16) NOT NULL DEFAULT 'draft',
  `audienceCount` INT NULL,
  `failureReason` VARCHAR(255) NULL,
  `createdBy` INT NULL,
  `sendingStartedAt` DATETIME(3) NULL,
  `completedAt` DATETIME(3) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  INDEX `campaign_shopId_createdAt_idx` (`shopId`, `createdAt`),
  CONSTRAINT `campaign_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `campaignrecipient` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `campaignId` INT NOT NULL,
  `shopId` INT NOT NULL,
  `email` VARCHAR(191) NULL,
  `status` VARCHAR(12) NOT NULL DEFAULT 'pending',
  `claimedAt` DATETIME(3) NULL,
  `sentAt` DATETIME(3) NULL,
  `unsubTokenHash` CHAR(64) NULL,
  `note` VARCHAR(191) NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `campaignrecipient_campaignId_email_key` (`campaignId`, `email`),
  UNIQUE INDEX `campaignrecipient_unsubTokenHash_key` (`unsubTokenHash`),
  INDEX `campaignrecipient_campaignId_status_idx` (`campaignId`, `status`, `claimedAt`),
  INDEX `campaignrecipient_shopId_status_sentAt_idx` (`shopId`, `status`, `sentAt`),
  CONSTRAINT `campaignrecipient_campaignId_fkey` FOREIGN KEY (`campaignId`) REFERENCES `campaign`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `emailsuppression` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `email` VARCHAR(191) NOT NULL,
  `reason` VARCHAR(16) NOT NULL,
  `campaignId` INT NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE INDEX `emailsuppression_shopId_email_key` (`shopId`, `email`),
  CONSTRAINT `emailsuppression_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- PLT-1: every plan carries a planfeature row for every registered key. Entitled on
-- every plan for now (a pricing decision for the owner to change, not a security
-- control); the shop's own state (default off) and the platform override still
-- decide whether it is on. Idempotent insert-if-missing.
INSERT INTO `planfeature` (`planId`, `featureKey`, `entitled`)
SELECT p.`id`, 'email_campaigns', 1 FROM `plan` p
WHERE NOT EXISTS (
  SELECT 1 FROM `planfeature` pf WHERE pf.`planId` = p.`id` AND pf.`featureKey` = 'email_campaigns'
);
