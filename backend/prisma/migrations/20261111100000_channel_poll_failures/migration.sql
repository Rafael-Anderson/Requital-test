-- E2. Consecutive failed polls of a marketplace connection (the webhook-outage
-- fallback), so a connection that fails for minutes is escalated once to the
-- merchant and logged for staff. Additive; every existing row starts at 0.
ALTER TABLE `channelconnection`
  ADD COLUMN `pollFailures` INT NOT NULL DEFAULT 0 AFTER `lastError`;
