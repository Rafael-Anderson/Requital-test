-- F/E5. A merchant asks Requital staff to verify a marketplace location. Once a day
-- per connection (compare-and-swap on this column); cleared in the same statement
-- as an id or credential change, like locationVerifiedAt. Additive.
ALTER TABLE `channelconnection`
  ADD COLUMN `verificationRequestedAt` DATETIME(3) NULL AFTER `locationVerifiedBy`;
