-- F/E5. Scheduled-order confirm step, mark-ready record. Additive; every existing
-- row keeps NULL / 0 (NULL = unknown, never a guess).
--   confirmBy        the marketplace's deadline to confirm an accepted scheduled order
--                    (Deliveroo confirm_at; which field is the real deadline is UNVERIFIED)
--   confirmedAt      when the scheduled order was confirmed (by us or on the tablet)
--   confirmClaimedAt CAS claim taken before the provider call (stale after 2 minutes)
--   readyAt          when a person marked the order ready for collection
ALTER TABLE `channelorder`
  ADD COLUMN `confirmBy` DATETIME(3) NULL AFTER `scheduledFor`,
  ADD COLUMN `confirmedAt` DATETIME(3) NULL AFTER `confirmBy`,
  ADD COLUMN `confirmClaimedAt` DATETIME(3) NULL AFTER `confirmedAt`,
  ADD COLUMN `readyAt` DATETIME(3) NULL AFTER `confirmClaimedAt`;

-- Per-connection opt-in: when 1 the sweep may confirm accepted scheduled orders
-- itself. OFF by default: confirming commits the merchant to prepare the order.
ALTER TABLE `channelconnection`
  ADD COLUMN `autoConfirmScheduled` TINYINT(1) NOT NULL DEFAULT 0 AFTER `pollFailures`;
