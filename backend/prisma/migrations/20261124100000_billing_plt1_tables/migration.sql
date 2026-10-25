-- PLT-1 first slice (docs/plans/phase3-billing.md section 3): the billing data
-- model, tables only. Additive; nothing here changes what any existing row does.
--
-- Deliberately NOT here: any price (planprice is created EMPTY and stays empty
-- until the owner sets a price book), billingcustomer/billingwebhookevent/
-- platforminvoice/usagenotice (phase 2, they exist only for Stripe), and the
-- dunning columns on shopsubscription (pastDueSince, graceEndsAt, pending plan).
-- `interval` is a reserved word in MySQL, so the column is billingInterval.
-- Seed and backfill are in the NEXT folder, which sorts strictly after this one.

CREATE TABLE `plan` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `code` VARCHAR(32) NOT NULL,
  `name` VARCHAR(100) NOT NULL,
  -- 'active' | 'retired' (retired = no new subscribers)
  `status` VARCHAR(16) NOT NULL DEFAULT 'active',
  -- 'legacy' | 'standard' | 'comp'
  `kind` VARCHAR(16) NOT NULL DEFAULT 'standard',
  -- legacy and comp plans can never be chosen by a merchant
  `isSelectable` BOOLEAN NOT NULL DEFAULT 0,
  -- orders per calendar month, NULL = no ceiling. Soft: messaging only, never blocks.
  `orderSoftCeiling` INT NULL,
  `sortOrder` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `plan_code_key` (`code`)
) DEFAULT CHARACTER SET utf8mb4;

-- One row per (plan, feature key). featureKey is validated in code against
-- FEATURE_KEYS, not a DB enum, so a key registered later needs a row here or it
-- is entitled by the fail-open rule (a missing row never switches a feature off).
CREATE TABLE `planfeature` (
  `planId` INT NOT NULL,
  `featureKey` VARCHAR(64) NOT NULL,
  `entitled` BOOLEAN NOT NULL,
  PRIMARY KEY (`planId`, `featureKey`),
  CONSTRAINT `planfeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plan` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4;

-- Created EMPTY on purpose: no price is decided yet, and none is baked in.
-- One active price per (plan, currency, interval) is enforced in the service
-- (MySQL has no partial unique index), like taxclass.isDefault.
CREATE TABLE `planprice` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `planId` INT NOT NULL,
  `currency` CHAR(3) NOT NULL,
  -- 'month' | 'year'
  `billingInterval` VARCHAR(8) NOT NULL,
  -- major units; KWD/BHD/OMR need 3 dp
  `amount` DECIMAL(12,3) NOT NULL,
  `stripePriceId` VARCHAR(255) NULL,
  `active` BOOLEAN NOT NULL DEFAULT 1,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  UNIQUE KEY `planprice_stripePriceId_key` (`stripePriceId`),
  KEY `planprice_planId_idx` (`planId`),
  CONSTRAINT `planprice_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plan` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4;

-- Exactly one CURRENT subscription per shop (shopId is the primary key); history
-- lives in subscriptionevent. Unknown stays NULL: a legacy shop has no currency,
-- interval, period or Stripe id, and none is invented for it.
CREATE TABLE `shopsubscription` (
  `shopId` INT NOT NULL,
  `planId` INT NOT NULL,
  -- 'trialing' | 'active' | 'past_due' | 'suspended' | 'cancelled'
  `status` VARCHAR(16) NOT NULL,
  -- 'legacy' | 'stripe' | 'comp'
  `source` VARCHAR(16) NOT NULL,
  `currency` CHAR(3) NULL,
  `billingInterval` VARCHAR(8) NULL,
  `planPriceId` INT NULL,
  `trialStartedAt` DATETIME(3) NULL,
  `trialEndsAt` DATETIME(3) NULL,
  `currentPeriodStart` DATETIME(3) NULL,
  `currentPeriodEnd` DATETIME(3) NULL,
  `cancelAtPeriodEnd` BOOLEAN NOT NULL DEFAULT 0,
  `cancelledAt` DATETIME(3) NULL,
  `stripeSubscriptionId` VARCHAR(255) NULL,
  -- compare-and-swap counter for every future transition
  `version` INT NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`shopId`),
  UNIQUE KEY `shopsubscription_stripeSubscriptionId_key` (`stripeSubscriptionId`),
  KEY `shopsubscription_planId_idx` (`planId`),
  CONSTRAINT `shopsubscription_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE,
  CONSTRAINT `shopsubscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `plan` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `shopsubscription_planPriceId_fkey` FOREIGN KEY (`planPriceId`) REFERENCES `planprice` (`id`) ON DELETE RESTRICT
) DEFAULT CHARACTER SET utf8mb4;

-- Append-only billing audit trail, including non-human actors (a platform audit
-- row cannot be written by Stripe or a sweep: platformAdminId is NOT NULL).
CREATE TABLE `subscriptionevent` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `shopId` INT NOT NULL,
  `fromStatus` VARCHAR(16) NULL,
  `toStatus` VARCHAR(16) NOT NULL,
  `fromPlanId` INT NULL,
  `toPlanId` INT NOT NULL,
  `reason` VARCHAR(64) NOT NULL,
  -- 'merchant' | 'platform_admin' | 'stripe' | 'system'
  `actorType` VARCHAR(16) NOT NULL,
  `actorId` INT NULL,
  `stripeEventId` VARCHAR(255) NULL,
  `metadata` JSON NULL,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`id`),
  KEY `subscriptionevent_shopId_createdAt_idx` (`shopId`, `createdAt`),
  CONSTRAINT `subscriptionevent_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4;

-- Why a shop is suspended, so a payment can lift only its own suspension and
-- never a platform one (section 4.3). NULL = not suspended, or suspended before
-- this column existed (the next folder backfills those to 'platform').
-- 'platform' | 'billing' | 'cancelled'
ALTER TABLE `shop` ADD COLUMN `suspensionReason` VARCHAR(16) NULL;
