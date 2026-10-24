-- F/E5. A merchant asks Requital staff to verify a marketplace location. Once a day
-- per connection. verificationRequestedAt is what the merchant sees and is cleared
-- in the same statement as an id or credential change, like locationVerifiedAt.
-- verificationNotifiedAt is the once-a-day compare-and-swap gate (and the staff
-- notification gate); NOTHING but a request ever writes it, so a PATCH cannot
-- reset the cooldown. Additive.
ALTER TABLE `channelconnection`
  ADD COLUMN `verificationRequestedAt` DATETIME(3) NULL AFTER `locationVerifiedBy`,
  ADD COLUMN `verificationNotifiedAt` DATETIME(3) NULL AFTER `verificationRequestedAt`;
