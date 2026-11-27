-- Where an order came from (orders/order-sources.ts): 'website' | 'custom' |
-- 'talabat' | 'deliveroo' (more marketplaces later, one registry entry each).
-- Additive and nullable. NULL = unknown: existing rows are NOT backfilled or
-- rewritten; their effective source is derived at read time from columns that
-- already exist (channel, the channelorder link, adminSource, draftOrderId).
-- Every new order writes it explicitly at creation.
ALTER TABLE `order` ADD COLUMN `source` VARCHAR(30) NULL;
