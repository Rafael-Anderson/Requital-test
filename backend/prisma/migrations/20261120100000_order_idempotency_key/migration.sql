-- F8: idempotent storefront checkout. The client mints one key per checkout
-- attempt; the server stores it on the order together with a fingerprint of the
-- request it came with, so a retry (double click, lost response, Back from the
-- gateway) returns the SAME order instead of creating and charging a second one,
-- and the same key with a different request is refused. Additive and nullable:
-- every existing order, and every order placed by an older client or another
-- channel, has no key (NULL), and NULLs are distinct under the unique index, so
-- nothing about them changes. The key is case-sensitive (utf8mb4_bin).
--
-- paymentSessionClaimedAt is a short LEASE, not a record: set (DB clock) while one
-- request is asking a payment gateway for a session for this order and cleared as
-- soon as the session is recorded or the call fails. A second request that finds a
-- fresh lease is told the session is being prepared instead of minting another, so
-- two concurrent submits can never leave two live sessions behind one order.
-- paymentSessionClaimToken identifies WHO holds the lease: recording the session
-- and releasing the lease are both guarded by it, so a stale attempt (its lease
-- lapsed and was taken over) can neither overwrite the new holder's session nor
-- clear its lease.
--
-- paymentSessionUrl / paymentSessionAt remember the checkout URL handed to the shopper
-- and when (DB clock), so a replay of the same checkout (Back from the gateway)
-- gets the SAME open session back instead of a second payable one; only a session
-- older than the reuse window is replaced (see PublicService.replayCheckout).
--
-- placedNotifiedAt makes the "we received your order" announcement once per order:
-- a CAS from NULL, so a replayed checkout that finds it unsent can send it and one
-- that finds it sent cannot send it twice.
ALTER TABLE `order`
  ADD COLUMN `paymentSessionClaimedAt` DATETIME(3) NULL,
  ADD COLUMN `paymentSessionClaimToken` VARCHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD COLUMN `placedNotifiedAt` DATETIME(3) NULL,
  ADD COLUMN `paymentSessionUrl` VARCHAR(2048) NULL,
  ADD COLUMN `paymentSessionAt` DATETIME(3) NULL,
  ADD COLUMN `idempotencyKey` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD COLUMN `idempotencyFingerprint` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE INDEX `order_shop_idempotencykey_key` (`shopId`, `idempotencyKey`);
