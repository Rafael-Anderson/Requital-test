-- "New" badge merchandising metadata on product (stakeholder request #6).
-- isNew: merchant-set flag; newUntil: optional calendar expiry (NULL = no
-- expiry, badge shows until isNew is turned off). Both additive with
-- column defaults, no backfill needed — every existing product row is
-- "not new". `product` has existed since the initial schema, so this
-- ALTER has no cross-migration ordering hazard against a clean-DB
-- `db:migrate`.
--
-- newUntil is DATE (not DATETIME): it is a timezone-less wall-clock
-- calendar date the merchant picks. "Is it still new" compares it, as a
-- 'YYYY-MM-DD' string (read via DATE_FORMAT), against today's date-key in
-- the SHOP's timezone (dateKeyInTimezone) — see PublicService and
-- product-is-new.ts.

ALTER TABLE `product`
  ADD COLUMN `isNew` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `newUntil` DATE NULL;
