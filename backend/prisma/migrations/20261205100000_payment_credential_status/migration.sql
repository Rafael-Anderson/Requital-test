-- Card-processor credential health (Nomod, Stripe). Additive only.
--
-- credentialStatus: NULL = unknown or fine (the state every existing row starts
--   in, nothing is backfilled), 'rejected' = the provider refused the shop's OWN
--   saved credentials (Nomod 401/403, Stripe authentication_error). While
--   rejected the storefront stops offering card payment for that provider.
-- credentialStatusAt: when the current status was first observed (kept across
--   repeated rejections so the banner shows the first failure).
-- credentialAlertedAt: the last time the merchant was alerted about a rejection;
--   at most one alert per 24 hours per provider (compare-and-swap on this column).
ALTER TABLE `shoppaymentprovider`
  ADD COLUMN `credentialStatus` VARCHAR(20) NULL,
  ADD COLUMN `credentialStatusAt` DATETIME(3) NULL,
  ADD COLUMN `credentialAlertedAt` DATETIME(3) NULL;
