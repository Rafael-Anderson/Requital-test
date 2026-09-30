-- Phase 2c / C1: freeze onto the invoice everything the document renders.
--
-- `invoice` already froze the money (subtotal/taxAmount/total, plus currency and
-- taxInclusive). Everything ELSE the document prints is still read LIVE from the
-- order and the shop at render time: the line items, the delivery fee, the
-- discount and its code, the payment method and status, the order number, the
-- customer block, and the shop's own name/address/email. So editing an order, or
-- a merchant renaming their shop, silently rewrites an invoice that was already
-- issued - and an invoice that changes after issue is not an invoice.
--
-- Real JSON type, not LONGTEXT with a CHECK: per the root CLAUDE.md, mysql2
-- auto-parses a genuine JSON column and does NOT auto-parse a LONGTEXT that
-- merely contains valid JSON. That distinction has bitten this codebase twice
-- (job.payload, themesettings.*), so the column is declared as what it is.
ALTER TABLE `invoice` ADD COLUMN `snapshotJson` JSON NULL;

-- Which shape `snapshotJson` is in. Stored rather than assumed so a later shape
-- change is detectable: the renderer falls back to live rendering for a version
-- it does not recognise, instead of reading fields that may have moved.
ALTER TABLE `invoice` ADD COLUMN `snapshotVersion` INTEGER NULL;

-- NO BACKFILL, deliberately. The invoices that already exist were rendered live,
-- and there is no way to reconstruct what they looked like when they were issued
-- - that information is exactly what was never captured. NULL means "no
-- snapshot", the renderer falls back to live rendering for those rows, and
-- nothing about them changes. Same argument orderitem.unitCost,
-- order.exchangeRate and orderitem.taxRate all made for their own history.
