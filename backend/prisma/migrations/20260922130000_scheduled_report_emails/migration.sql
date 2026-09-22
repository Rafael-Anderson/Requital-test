-- ANL-5: opt-in scheduled report emails.
--
-- BOTH DEFAULT FALSE, deliberately. Every existing shop has a real merchant
-- behind it who never asked for these, and turning on an automated daily email
-- for the whole platform by migration is the kind of change that is discovered
-- in someone's inbox rather than in a changelog. The same shape and the same
-- reasoning as notifyLowStockDigest, which this sits beside.
--
-- The *LastSentAt columns are the per-shop send guard, not decoration: the
-- sweep claims a send by comparing against them, so a cron that ticks more than
-- once (or two PM2 instances racing a tick, on top of the advisory lock) cannot
-- send the same merchant the same summary twice.
ALTER TABLE `shop`
  ADD COLUMN `notifyDailySalesSummary` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `shop`
  ADD COLUMN `notifyWeeklyDigest` BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE `shop`
  ADD COLUMN `dailySalesSummaryLastSentAt` DATETIME(3) NULL;

ALTER TABLE `shop`
  ADD COLUMN `weeklyDigestLastSentAt` DATETIME(3) NULL;
