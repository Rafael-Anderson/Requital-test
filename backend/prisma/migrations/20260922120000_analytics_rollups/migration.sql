-- ANL-1: nightly rollup tables. Pre-aggregated per-day metrics so the
-- reporting layer stops re-scanning `order`/`orderitem` for every question,
-- and so cost-of-goods can be reported from the unitCost captured at order
-- time (migration 20260921120000) rather than from today's product.costPrice.
--
-- THREE DELIBERATE SHAPE DECISIONS, each of which a reader will otherwise
-- wonder about:
--
-- 1. Rollups are per OUTLET, never "shop-wide with a NULL outletId".
--    MySQL forbids a NULL in a PRIMARY KEY, so a shop-wide row would need
--    either a sentinel outletId (0) or a second table, and it would store the
--    same money twice in two places that can silently disagree. `order`
--    always carries a real outletId (it is NOT NULL, and a branch user's is
--    forced server-side), so a shop-wide figure is SUM() over this table's
--    outlet rows at query time. One source of truth per number.
--
-- 2. `cogs` is NULLABLE and means "the cost of the lines we actually know the
--    cost of" - it is NOT a zero-filled total. Part A established that a zero
--    cost reports as 100% margin, which is a worse lie than "unknown", so the
--    same discipline applies here: a bucket where no line carried a captured
--    unitCost stores NULL, not 0. `linesWithoutCost` counts the lines left
--    out, so a report can say how complete the number is instead of implying
--    precision it does not have.
--
-- 3. Cancelled orders are EXCLUDED. This matches Dashboard and the Product
--    Sales Report (and deliberately not the General Report, which is a raw
--    audit view - see CLAUDE.md). A rollup is a business-performance number,
--    so a cancelled order is not revenue.
--
-- `computedAt` is not decoration: it is how the catch-up path and any future
-- "is this stale?" check tell a day that was genuinely computed as empty from
-- a day that was never computed at all. A missing ROW means "not yet
-- computed"; a row with orders = 0 means "computed, and nothing happened".

CREATE TABLE `dailyshopmetrics` (
  `shopId` INT NOT NULL,
  `outletId` INT NOT NULL,
  `date` DATE NOT NULL,
  `orders` INT NOT NULL DEFAULT 0,
  `revenue` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `cogs` DECIMAL(65, 30) NULL,
  `discount` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `delivery` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `tax` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `newCustomers` INT NOT NULL DEFAULT 0,
  `returningCustomers` INT NOT NULL DEFAULT 0,
  `linesWithoutCost` INT NOT NULL DEFAULT 0,
  `computedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`shopId`, `outletId`, `date`),
  INDEX `DailyShopMetrics_shopId_date_idx`(`shopId`, `date`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `dailyshopmetrics`
  ADD CONSTRAINT `DailyShopMetrics_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `dailyproductmetrics` (
  `shopId` INT NOT NULL,
  `productId` INT NOT NULL,
  `outletId` INT NOT NULL,
  `date` DATE NOT NULL,
  `units` INT NOT NULL DEFAULT 0,
  `revenue` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `cogs` DECIMAL(65, 30) NULL,
  `linesWithoutCost` INT NOT NULL DEFAULT 0,
  `computedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`shopId`, `productId`, `outletId`, `date`),
  INDEX `DailyProductMetrics_shopId_date_idx`(`shopId`, `date`),
  INDEX `DailyProductMetrics_shopId_productId_idx`(`shopId`, `productId`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `dailyproductmetrics`
  ADD CONSTRAINT `DailyProductMetrics_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Current-state snapshot per customer, NOT a per-day series: firstOrder /
-- lastOrder / orderCount / ltv are answers about a customer's whole history,
-- so there is nothing to bucket by date. Recomputed wholesale per shop on the
-- nightly tick, which is also what makes it idempotent.
--
-- ltv deliberately mirrors CustomersService's live computation (excludes
-- cancelled orders) so the rollup and the customer detail page cannot
-- disagree - see AnalyticsRollupService for the shared exclusion.
CREATE TABLE `customermetrics` (
  `shopId` INT NOT NULL,
  `customerId` INT NOT NULL,
  `firstOrder` DATETIME(3) NULL,
  `lastOrder` DATETIME(3) NULL,
  `orderCount` INT NOT NULL DEFAULT 0,
  `ltv` DECIMAL(65, 30) NOT NULL DEFAULT 0,
  `computedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`shopId`, `customerId`),
  INDEX `CustomerMetrics_shopId_lastOrder_idx`(`shopId`, `lastOrder`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `customermetrics`
  ADD CONSTRAINT `CustomerMetrics_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE `customermetrics`
  ADD CONSTRAINT `CustomerMetrics_customerId_fkey`
  FOREIGN KEY (`customerId`) REFERENCES `customer`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
