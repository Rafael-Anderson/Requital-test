-- Per-zone map center + delivery radius (Delivery zones modal Google Maps
-- rework) -- additive to deliveryzone's existing flat-fee fields. camelCase
-- to match every other column in this table/schema, not the snake_case
-- naming the feature request used generically.
ALTER TABLE `deliveryzone`
  ADD COLUMN `lat` DECIMAL(10,6) DEFAULT NULL,
  ADD COLUMN `lng` DECIMAL(10,6) DEFAULT NULL,
  ADD COLUMN `radiusKm` DECIMAL(8,2) DEFAULT NULL;
