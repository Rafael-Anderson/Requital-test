-- A separate RECEIVER (the person who gets the order), captured on the order at checkout.
-- NULL on both columns = the customer is the receiver (the only meaning an order placed before
-- this migration can have). Nothing is backfilled and nothing is ever defaulted from the customer
-- columns: the pair is written only when the shopper said someone else receives it, and then both
-- are set together (enforced in the API, not by a constraint). Same widths as customerName and
-- customerPhone. Additive only.
ALTER TABLE `order`
  ADD COLUMN `receiverName` VARCHAR(191) NULL,
  ADD COLUMN `receiverPhone` VARCHAR(191) NULL;
