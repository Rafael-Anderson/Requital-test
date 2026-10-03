-- STF-4: an active-session list. A "session" is a refresh-token family (one
-- login = one familyId, rotated many times), so no new table: the device
-- details ride on the refreshtoken rows. NULL = unknown (a row written before
-- this migration), never a placeholder. Purely additive.
ALTER TABLE `refreshtoken`
  ADD COLUMN `userAgent` VARCHAR(255) NULL,
  ADD COLUMN `ip` VARCHAR(64) NULL;
