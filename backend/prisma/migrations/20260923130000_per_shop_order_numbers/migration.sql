-- Per-shop order numbers. `order.id` is a single global AUTO_INCREMENT shared by
-- every shop, so a merchant's "Order #" is really a platform-wide counter: 81%
-- of adjacent ids belong to different shops, and a brand-new shop's first order
-- displays as #56410 rather than #1. That leaks roughly how many orders every
-- other shop has taken and makes a new merchant look like they lost 56,000
-- orders.
--
-- STRICTLY ADDITIVE. order.id remains the PRIMARY KEY and the internal identity
-- for all 13 foreign keys, every /orders/:id URL, trackingToken lookups, and
-- every payment-gateway metadata round trip (Stripe metadata.orderId, PayPal
-- custom_id, Tabby reference_id, Slider order_id all come back to us and are
-- resolved with WHERE id = ?). Nothing is renumbered. Only the number shown to
-- a human changes.

-- Same shape as `invoicecounter`, deliberately a SEPARATE table rather than
-- invoicecounter with a type='ORDER' row: that column's domain is InvoiceType,
-- its accessor is a private method of InvoicesService returning a formatted
-- string ('INV-0001') rather than an integer, and order numbering should not
-- depend on the invoices module. What is reused is the atomic-upsert PATTERN,
-- not the table. No type discriminator is needed here, so the key is just
-- shopId.
CREATE TABLE `ordercounter` (
  `shopId` INT NOT NULL,
  `lastNumber` INT NOT NULL,
  PRIMARY KEY (`shopId`)
) DEFAULT CHARACTER SET utf8mb4;

ALTER TABLE `ordercounter`
  ADD CONSTRAINT `OrderCounter_shopId_fkey`
  FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- Expand/contract per CLAUDE.md: nullable column -> backfill -> NOT NULL ->
-- index.
ALTER TABLE `order` ADD COLUMN `shopOrderNumber` INT NULL;

-- ORDER BY createdAt ASC, id ASC - the `id` tiebreaker is NOT decoration.
-- createdAt is datetime(3) and 99 (shopId, createdAt) groups in the existing
-- data share an identical millisecond, up to 5 orders deep. Ordering by
-- createdAt alone would number those non-deterministically, so a re-run could
-- produce different numbers for the same rows. Within one millisecond the
-- insert order IS the id order, which makes id the correct tiebreaker rather
-- than merely a stable one.
UPDATE `order` o
JOIN (
  SELECT id, ROW_NUMBER() OVER (
    PARTITION BY shopId ORDER BY createdAt ASC, id ASC
  ) AS n
  FROM `order`
) seq ON seq.id = o.id
SET o.shopOrderNumber = seq.n;

-- Seed the counter from what was just assigned, so the next order continues a
-- shop's sequence instead of restarting at 1.
INSERT INTO `ordercounter` (`shopId`, `lastNumber`)
SELECT `shopId`, MAX(`shopOrderNumber`) FROM `order` GROUP BY `shopId`;

-- NOT NULL with no default is part of the safety argument: an INSERT that
-- forgets to supply a number now fails loudly at the database rather than
-- silently writing a NULL that some display would render as blank.
ALTER TABLE `order` MODIFY COLUMN `shopOrderNumber` INT NOT NULL;

-- The real guarantee that concurrent order creation cannot hand the same number
-- to two orders. Without it the counter is merely usually-correct; with it a
-- collision is a failed insert instead of a silent duplicate.
CREATE UNIQUE INDEX `Order_shopId_shopOrderNumber_key`
  ON `order` (`shopId`, `shopOrderNumber`);
