-- AlterTable
ALTER TABLE `shop` ADD COLUMN `published` BOOLEAN NOT NULL DEFAULT false;

-- Backfill: mark a shop published if it looks like it's actually been set
-- up, not just signed up. Proxy: at least one outlet that can actually take
-- orders (deliveryEnabled or pickupEnabled — mere row existence isn't a
-- useful signal, since every signup auto-creates one default outlet with
-- both flags false) AND at least one product in the catalog. Anything short
-- of that (never configured an outlet for real, or never added a product)
-- reads as an abandoned/mid-setup signup and stays unpublished — the
-- merchant publishes explicitly once ready (see admin Settings > Business
-- Information). New signups after this migration already default to
-- `false` via the column default above, so this UPDATE only ever affects
-- pre-existing rows.
UPDATE `shop`
SET `published` = true
WHERE EXISTS (
    SELECT 1 FROM `outlet`
    WHERE `outlet`.`shopId` = `shop`.`id`
      AND (`outlet`.`deliveryEnabled` = true OR `outlet`.`pickupEnabled` = true)
  )
  AND EXISTS (
    SELECT 1 FROM `product`
    WHERE `product`.`shopId` = `shop`.`id`
  );
