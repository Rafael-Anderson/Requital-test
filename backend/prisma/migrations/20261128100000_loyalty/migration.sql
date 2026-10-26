-- CUS-5: loyalty points. Behind the `loyalty` feature key (platform grant,
-- default off) AND the shop's own `loyaltyprogram.enabled` (default off). Every
-- statement is additive.
--
-- loyaltyprogram: ONE row per shop, created on first save. No rate is baked in:
-- earnRate 0 earns nothing, and a shop cannot be switched on with a zero rate.
--   earnRate         points per ONE currency unit of the earn base (DECIMAL(12,4),
--                    read as an exact decimal string).
--   earnBase         'net_paid' (default): order total minus delivery fee, minus
--                    tax, minus the part paid with a gift card or store credit.
--                    'items_after_discount': the same without the tender
--                    subtraction (gift-card and credit-paid money counts).
--   redeemEnabled    points -> store credit. Default off; also gated in code on
--                    the shop's phone_otp_register flag.
--   redeemPointsPerUnit  points that buy ONE currency unit of store credit.
--   redeemMinPoints / redeemStepPoints / redeemMaxPoints  per-redemption limits
--                    (max NULL = no per-redemption cap, balance still bounds it).
-- Expiry is NOT built (owner decision open), so there is no column for it.
CREATE TABLE `loyaltyprogram` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `earnRate` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `earnBase` VARCHAR(24) NOT NULL DEFAULT 'net_paid',
    `redeemEnabled` BOOLEAN NOT NULL DEFAULT false,
    `redeemPointsPerUnit` DECIMAL(12, 4) NOT NULL DEFAULT 0,
    `redeemMinPoints` INTEGER NOT NULL DEFAULT 1,
    `redeemStepPoints` INTEGER NOT NULL DEFAULT 1,
    `redeemMaxPoints` INTEGER NULL,
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `loyaltyprogram_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- loyaltyentry: an APPEND-ONLY ledger like storecreditentry. A customer's balance
-- is SUM(points); no balance column can drift from the history that explains it.
-- The only UPDATEs the application ever issues are the customer-merge re-point of
-- `customerId` and the PDPL scrub of `reason`.
--   points     signed integer: + earn / + positive adjust, - clawback / redeem /
--              negative adjust.
--   shortfall  clawback only: points that should have been taken back but the
--              balance could not cover (the ledger never goes below zero). Kept
--              so the next clawback on the same order can still reach the right
--              cumulative figure and so the merchant can see it.
-- Idempotency lives in the unique keys:
--   (orderId, entryType)     one earn per order
--   (returnId, entryType)    one clawback per return
--   (shopId, idempotencyKey) a retried redeem or admin adjust (NULLs are distinct)
-- FKs to customer/order/orderreturn are RESTRICT: a ledger row is never removed
-- by a delete elsewhere.
CREATE TABLE `loyaltyentry` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `customerId` INTEGER NOT NULL,
    `entryType` VARCHAR(16) NOT NULL,
    `points` INTEGER NOT NULL,
    `shortfall` INTEGER NOT NULL DEFAULT 0,
    `reason` VARCHAR(500) NULL,
    `orderId` INTEGER NULL,
    `returnId` INTEGER NULL,
    `storeCreditEntryId` INTEGER NULL,
    `actorUserId` INTEGER NULL,
    `idempotencyKey` VARCHAR(80) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `loyaltyentry_orderId_entryType_key`(`orderId`, `entryType`),
    UNIQUE INDEX `loyaltyentry_returnId_entryType_key`(`returnId`, `entryType`),
    UNIQUE INDEX `loyaltyentry_shopId_idempotencyKey_key`(`shopId`, `idempotencyKey`),
    INDEX `loyaltyentry_shopId_customerId_idx`(`shopId`, `customerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `loyaltyprogram` ADD CONSTRAINT `loyaltyprogram_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `loyaltyentry` ADD CONSTRAINT `loyaltyentry_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `loyaltyentry` ADD CONSTRAINT `loyaltyentry_customerId_fkey` FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `loyaltyentry` ADD CONSTRAINT `loyaltyentry_orderId_fkey` FOREIGN KEY (`orderId`) REFERENCES `order`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `loyaltyentry` ADD CONSTRAINT `loyaltyentry_returnId_fkey` FOREIGN KEY (`returnId`) REFERENCES `orderreturn`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `loyaltyentry` ADD CONSTRAINT `loyaltyentry_actorUserId_fkey` FOREIGN KEY (`actorUserId`) REFERENCES `user`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- PLT-1: every plan carries a planfeature row for every registered key (billing
-- test). Loyalty is a retention feature, not a paid tier decision made here: every
-- plan is entitled, and the platform grant (override) plus the shop's own program
-- switch still decide whether it is on. Idempotent, insert-if-missing.
INSERT INTO `planfeature` (`planId`, `featureKey`, `entitled`)
SELECT p.`id`, 'loyalty', 1 FROM `plan` p
WHERE NOT EXISTS (
  SELECT 1 FROM `planfeature` pf WHERE pf.`planId` = p.`id` AND pf.`featureKey` = 'loyalty'
);
