-- Per-product override of the shop-wide estimated delivery time (PDP
-- "Delivered in X" line, replacing the plain stock-status text). All three
-- columns NULL (every existing row) means "use shop.estimatedDeliveryTime*"
-- — additive, no backfill, matching the isNew/newUntil precedent.
--
-- Deliberately mirrors shop.estimatedDeliveryTimeFrom/To/Unit's shape
-- (from/to/unit) rather than a new value+unit shape, so the same
-- resolve+format logic works for both (see storefront/lib/delivery-time.ts).
-- Unit is an unconstrained VARCHAR here too, same as the shop column —
-- "days" is a valid value alongside "minutes"/"hours", enforced by the DTO
-- (@IsIn) and the admin form, not the schema. `product` has existed since
-- the initial schema, so this ALTER has no cross-migration ordering hazard
-- against a clean-DB `db:migrate`.

ALTER TABLE `product`
  ADD COLUMN `estimatedDeliveryTimeFrom` INT NULL,
  ADD COLUMN `estimatedDeliveryTimeTo` INT NULL,
  ADD COLUMN `estimatedDeliveryTimeUnit` VARCHAR(191) NULL;
