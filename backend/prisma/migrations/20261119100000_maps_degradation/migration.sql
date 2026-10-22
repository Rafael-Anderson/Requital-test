-- F9: Google Maps degradation. Additive only.
-- order.addressUnverified: set when a delivery order was placed with a typed
-- address and no map pin because Maps was unavailable for the shopper (the
-- merchant should confirm the address with the customer). 0 = a pin was given,
-- or pickup, or an order from before this migration.
ALTER TABLE `order` ADD COLUMN `addressUnverified` TINYINT(1) NOT NULL DEFAULT 0;

-- Shopper-origin beacon: one row per (shop, error code, host), bounded by
-- construction (4 codes x the shop's own hosts; hosts are validated against
-- shopOwnHosts before a write). Read by GET /shop/maps-health.
CREATE TABLE `mapserrorlog` (
  `shopId` INT NOT NULL,
  `code` VARCHAR(40) NOT NULL,
  `host` VARCHAR(255) NOT NULL,
  `hitCount` INT UNSIGNED NOT NULL DEFAULT 1,
  `firstSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (`shopId`, `code`, `host`),
  CONSTRAINT `mapserrorlog_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop` (`id`) ON DELETE CASCADE
) DEFAULT CHARACTER SET utf8mb4;
