-- W1: customer account takeover. Password reset used to run on customer.email,
-- which a guest checkout could overwrite by phone match. A reset now goes ONLY to
-- an address the account owner proved by clicking a link.
--
-- verifiedEmail is the proven address (NULL = nothing proven; no backfill, since
-- nothing records where a legacy email came from). It is a separate column from
-- email on purpose: no code path that edits email (checkout, import, merge, admin,
-- profile) can ever change it, only the verification endpoint writes it. The
-- unique index makes a verified address belong to one account per shop, atomically
-- (NULLs are distinct, so unproven rows never collide). emailVerified (BOOLEAN,
-- never written by any code) is left untouched and no longer read.
ALTER TABLE `customer`
  ADD COLUMN `verifiedEmail` VARCHAR(191) NULL,
  ADD COLUMN `emailVerifiedAt` DATETIME(3) NULL,
  ADD UNIQUE INDEX `customer_shopId_verifiedEmail_key`(`shopId`, `verifiedEmail`);

-- The address a token was issued for. A reset token is honoured only while its
-- targetEmail still equals the account's verifiedEmail, so every reset link issued
-- before this migration (targetEmail NULL, sent to an unproven address) is dead on
-- arrival, and a link goes stale when the verified address changes.
ALTER TABLE `customerauthtoken` ADD COLUMN `targetEmail` VARCHAR(191) NULL;
