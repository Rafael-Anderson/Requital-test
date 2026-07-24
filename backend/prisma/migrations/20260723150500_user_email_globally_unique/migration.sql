-- Login is email+password with no shop/subdomain selector, so email needs to
-- be a stable global identity, not just unique within a shop (the previous
-- (shopId, email) composite would let the same email ambiguously belong to
-- two different shops, which login as written couldn't disambiguate).

-- New indexes first: the old composite index is the only thing satisfying
-- the shopId foreign key's indexing requirement, so it can't be dropped
-- until a replacement index on shopId exists.
CREATE INDEX `User_shopId_fkey` ON `user`(`shopId`);
CREATE UNIQUE INDEX `User_email_key` ON `user`(`email`);
ALTER TABLE `user` DROP INDEX `User_shopId_email_key`;
