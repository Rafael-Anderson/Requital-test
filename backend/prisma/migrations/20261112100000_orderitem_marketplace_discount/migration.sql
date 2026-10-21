-- E3: an item-level discount stated by a marketplace (Talabat's order payload
-- carries one per item) is captured on the order line instead of being dropped
-- when the canonical snapshot is cleared. Additive, nullable, not backfilled:
-- NULL means the marketplace did not state one (unknown), never zero, and every
-- existing line (all non-marketplace orders, all E1 orders) stays NULL.
-- orderitem.priceAtPurchase stays the unit price BEFORE this discount; the
-- order's own total is what the marketplace says the customer paid.
ALTER TABLE `orderitem` ADD COLUMN `marketplaceDiscountAmount` DECIMAL(65, 30) NULL;
