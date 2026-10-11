-- W3: editing an order that spent store credit can lower its total below what the
-- order holds in gift card + store credit. The excess credit goes back to the
-- ledger as a 'spend_release' entry, and an order can be edited many times, so
-- (orderId, entryType) is no longer enough to make an entry unique.
--
-- `editSeq` is the 1-based number of the edit within the order for a
-- 'spend_release' row and 0 for every other entry (spend, spend_reversal), which
-- keeps the old one-spend / one-reversal-per-order guarantee exactly (their
-- editSeq is always 0) while allowing several partial releases. NOT NULL with a
-- default of 0, not nullable: NULLs are distinct in a MySQL unique index, which
-- would silently drop the guarantee for the 0 rows.
--
-- The new unique index is created BEFORE the old one is dropped: the orderId
-- foreign key needs an index that starts with orderId at every moment.
ALTER TABLE `storecreditentry` ADD COLUMN `editSeq` INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX `storecreditentry_orderId_entryType_editSeq_key` ON `storecreditentry`(`orderId`, `entryType`, `editSeq`);
DROP INDEX `storecreditentry_orderId_entryType_key` ON `storecreditentry`;
