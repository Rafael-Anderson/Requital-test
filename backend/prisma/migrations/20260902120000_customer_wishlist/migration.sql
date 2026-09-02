-- Wishlist storage: a JSON array of product ids on customer, mirroring
-- the existing customer.addresses precedent (added in 20260724200000).
-- Additive, nullable, no backfill: every existing customer row keeps NULL
-- and CustomerAccountService treats NULL as an empty wishlist. `customer`
-- has existed since 20260724200000, so this ALTER has no cross-migration
-- ordering hazard against a clean-DB `db:migrate`.

ALTER TABLE `customer` ADD COLUMN `wishlist` JSON NULL;
