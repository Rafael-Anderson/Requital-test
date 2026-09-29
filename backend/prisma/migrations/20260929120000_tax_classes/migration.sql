-- Phase 2b / B1: tax classes, and a per-product assignment to one.
--
-- Today there is exactly ONE tax rate per shop (`shop.taxRate`), applied to the
-- whole goods subtotal, never to delivery, and `product.chargeTax` is ignored
-- entirely by the pricing path. A UAE merchant selling anything zero-rated or
-- exempt (some food, certain healthcare and education goods, exports) therefore
-- overcharges VAT and files a wrong return. See the capability audit's I18N-5.
--
-- THIS MIGRATION CHANGES NO PRICE. It adds the schema and assigns every existing
-- product to a class that reproduces its current behaviour exactly; the per-line
-- computation that reads these columns is B2. That split is deliberate: a schema
-- change and a money-math change should not land in the same deploy.
--
-- `type` is a plain VARCHAR validated in the DTO, not a CHECK constraint or a
-- MySQL ENUM — every other enum-ish column in this schema (`order.status`,
-- `shoppaymentprovider.provider`, `biolink.type`) is a VARCHAR, and there is not
-- one CHECK constraint in the whole migration history. Matching that rather than
-- introducing a second convention.

-- ── The classes ─────────────────────────────────────────────────────────────
-- Shop-scoped like every other tenant-owned table. `rate` reuses
-- `shop.taxRate`'s own DECIMAL(5,2) — a percentage, not money, so it must NOT
-- take the money columns' DECIMAL(65,30) convention (see 20260926220000's own
-- note about `currencyrate.rate` for the same argument).
CREATE TABLE `taxclass` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `rate` DECIMAL(5, 2) NOT NULL DEFAULT 0,
    -- standard | zero | exempt | out_of_scope. `zero` and `exempt` are both 0%
    -- but are NOT interchangeable on a VAT return: a zero-rated sale is taxable
    -- at 0% and recoverable, an exempt one is outside the recovery scheme. That
    -- distinction is the whole reason `type` exists next to `rate`.
    `type` VARCHAR(191) NOT NULL,
    -- The class a new product gets when none is chosen. Exactly one per shop is
    -- enforced in TaxClassesService, not by the schema — a partial unique index
    -- over (shopId) WHERE isDefault is not expressible in MySQL.
    `isDefault` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `TaxClass_shopId_name_key`(`shopId`, `name`),
    INDEX `TaxClass_shopId_idx`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `taxclass` ADD CONSTRAINT `TaxClass_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- ── The assignment ──────────────────────────────────────────────────────────
-- NULL is a real state, not a gap: it means "this product has no class of its
-- own", and B2's computation falls back to the shop's default class. ON DELETE
-- SET NULL so deleting a class never cascades into the catalog — the product
-- survives and falls back, which is the only non-destructive reading.
ALTER TABLE `product` ADD COLUMN `taxClassId` INTEGER NULL;
ALTER TABLE `product` ADD CONSTRAINT `Product_taxClassId_fkey`
    FOREIGN KEY (`taxClassId`) REFERENCES `taxclass`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- ── Delivery ────────────────────────────────────────────────────────────────
-- DEFAULT false preserves today's documented behaviour exactly: `order-pricing.ts`
-- has never taxed the delivery fee, and its own header comment says to revisit
-- if a merchant needs it. This is that switch, off by default, read by B2.
ALTER TABLE `shop` ADD COLUMN `taxOnDelivery` BOOLEAN NOT NULL DEFAULT false;

-- ── Backfill ────────────────────────────────────────────────────────────────
-- Two classes per shop: a `standard` one carrying that shop's CURRENT taxRate
-- (so nothing re-prices), and a `zero` one at 0 for the products that had
-- chargeTax unticked. Reading each shop's own rate rather than assuming a single
-- platform rate keeps this correct for a shop that has customised it.
INSERT INTO `taxclass` (`shopId`, `name`, `rate`, `type`, `isDefault`)
SELECT s.id, 'Standard', s.taxRate, 'standard', TRUE FROM `shop` s;

INSERT INTO `taxclass` (`shopId`, `name`, `rate`, `type`, `isDefault`)
SELECT s.id, 'Zero rated', 0, 'zero', FALSE FROM `shop` s;

-- `product.chargeTax` is the migration source, exactly as the audit proposed:
-- unticked becomes the zero class rather than the column being deleted.
--
-- `chargeTax` is NOT dropped here, and is not dead. It is part of the CSV
-- import/export contract (`products-import.ts`'s header, `export-definitions.ts`)
-- with a round-trip e2e asserting it survives, and it is inherited on duplicate.
-- Removing it is a separate contract change, not this migration.
UPDATE `product` p
  JOIN `taxclass` t ON t.shopId = p.shopId AND t.type = 'standard'
   SET p.taxClassId = t.id
 WHERE p.chargeTax = TRUE;

UPDATE `product` p
  JOIN `taxclass` t ON t.shopId = p.shopId AND t.type = 'zero'
   SET p.taxClassId = t.id
 WHERE p.chargeTax = FALSE;
