-- Same-day delivery cutoff (stakeholder #13). A shop-level "HH:MM"
-- wall-clock time; NULL = the shop does not advertise a same-day
-- earliest-delivery estimate (the feature is off). Shop-level, not
-- outlet-level: the collection page and product card have no resolved
-- outlet, so an outlet-scoped cutoff shown there would be misleading.
-- Future expansion path: an outlet.sameDayCutoffTime column that falls
-- back to this shop value when NULL.
--
-- Additive, nullable, no backfill. `shop` has existed since the initial
-- schema, so no cross-migration ordering hazard against a clean-DB
-- db:migrate.

ALTER TABLE `shop` ADD COLUMN `sameDayCutoffTime` VARCHAR(5) NULL;
