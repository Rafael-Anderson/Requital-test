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
ALTER TABLE `order`
  ADD COLUMN `paymentSessionClaimedAt` DATETIME(3) NULL,
  ADD COLUMN `idempotencyKey` VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
  ADD COLUMN `idempotencyFingerprint` CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
  ADD UNIQUE INDEX `order_shop_idempotencykey_key` (`shopId`, `idempotencyKey`);
