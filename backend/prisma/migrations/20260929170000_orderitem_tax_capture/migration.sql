-- Phase 2b / B2: capture the tax each order LINE actually bore, and make the
-- invoice's own arithmetic add up.
--
-- Today `order.taxAmount` stores a tax *amount* and nothing stores the *rate*,
-- so a historical order's tax is unauditable: you cannot tell 5% of 100 from
-- 10% of 50, and you certainly cannot tell which lines were zero-rated. That is
-- what a VAT return and (later) I18N-7 e-invoicing both need.
--
-- ALL THREE COLUMNS NULLABLE AND DELIBERATELY NOT BACKFILLED. Every order placed
-- before this migration has no per-line tax record, and there is no correct value
-- to invent: the shop-level rate that happened to exist then is not the same
-- claim as "the rate this line was charged at". NULL means UNKNOWN, never zero —
-- exactly the argument `orderitem.unitCost` made for cost (migration
-- 20260921120000) and `order.exchangeRate` made for the FX rate (20260926220000).
-- A consumer must treat NULL as "not captured", not as an untaxed line.

ALTER TABLE `orderitem` ADD COLUMN `taxClassId` INTEGER NULL;
ALTER TABLE `orderitem` ADD CONSTRAINT `OrderItem_taxClassId_fkey`
    FOREIGN KEY (`taxClassId`) REFERENCES `taxclass`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- The rate as applied, frozen. `taxClassId` above can go NULL if the merchant
-- later deletes the class (ON DELETE SET NULL, so the catalog is never
-- cascade-deleted), which is precisely why the rate is stored separately rather
-- than being re-read through the class: the number charged survives the class.
-- DECIMAL(5,2) matches `shop.taxRate` and `taxclass.rate` — a percentage, not
-- money, so deliberately not the money columns' DECIMAL(65,30).
ALTER TABLE `orderitem` ADD COLUMN `taxRate` DECIMAL(5, 2) NULL;

-- The money. DECIMAL(65,30) is this schema's money convention.
ALTER TABLE `orderitem` ADD COLUMN `taxAmount` DECIMAL(65, 30) NULL;

-- ── The invoice's own arithmetic ────────────────────────────────────────────
-- `invoice-html.ts` prints Subtotal, Discount, Delivery, Tax, Total as a column
-- the reader adds up. On a tax-EXCLUSIVE shop it does add up:
--   subtotal - discount + delivery + tax = total
-- On a tax-INCLUSIVE shop it does not, and is overstated by exactly the tax:
-- `invoice.subtotal` is the sum of `priceAtPurchase * quantity`, which on an
-- inclusive shop ALREADY contains the tax, so printing Tax as a further addend
-- double-counts it.
--
-- Fixing that at render time needs to know how the order was priced, and reading
-- `shop.taxInclusive` LIVE would mean a merchant flipping that toggle silently
-- rewrites the arithmetic of every invoice already issued — the same failure
-- mode `invoice.currency` was added to close. So it is captured here, per
-- invoice, at issue time.
--
-- NOT NULL with a `false` default only because every existing row needs some
-- value; `false` (exclusive) is the shape whose arithmetic was already correct,
-- so no already-issued invoice changes how it renders.
ALTER TABLE `invoice` ADD COLUMN `taxInclusive` BOOLEAN NOT NULL DEFAULT false;

-- Existing invoices: adopt their own shop's current setting, which is the best
-- available evidence of how they were priced and is exactly right for the
-- overwhelming case of a shop that has never changed it.
UPDATE `invoice` i JOIN `shop` s ON s.id = i.shopId SET i.taxInclusive = s.taxInclusive;
