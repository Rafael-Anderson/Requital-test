-- Phase 2c / C2: mark an invoice whose order has moved on.
--
-- C1 froze the document at issue, which is what an invoice has to be. The
-- consequence is that an invoice can now legitimately disagree with its order:
-- edit the items, change the delivery fee, cancel the order or process a return,
-- and the frozen document is still correct about what was issued but no longer
-- describes what the order is. Staff need to see that, or they hand a customer a
-- document that quietly contradicts the live order.
--
-- NULL means "still describes its order". A timestamp means the order changed
-- after this invoice was issued, and records WHEN - useful in the audit trail and
-- enough for the admin to say so.
ALTER TABLE `invoice` ADD COLUMN `supersededAt` DATETIME(3) NULL;

-- NO BACKFILL. An existing invoice may or may not already disagree with its
-- order, and there is no record of whether it does: the order-mutating paths were
-- not tracking this. Marking them all would be a false claim about 12 documents;
-- marking none is the honest default, and any future edit to those orders marks
-- them correctly from then on.
