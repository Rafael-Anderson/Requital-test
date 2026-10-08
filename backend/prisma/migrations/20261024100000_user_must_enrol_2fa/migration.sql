-- S1a: a platform-admin reset of a shop user's two-factor forces that user to
-- enrol again even when the shop does not require 2FA. AuthGuard confines a
-- user with this flag set and no confirmed second factor to the
-- @AllowPendingMfa routes, exactly like shop.require2fa; confirming enrolment
-- clears it. Additive, default 0: no behaviour change for any existing user.
ALTER TABLE `user` ADD COLUMN `mustEnrol2fa` TINYINT(1) NOT NULL DEFAULT 0;
