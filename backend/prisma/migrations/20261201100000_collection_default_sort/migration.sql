-- Default sort per collection. NULL = the storefront's long-standing default (Newest),
-- so every existing collection behaves exactly as before. The allowed keys are the ones
-- the storefront collection page already offers its customers (validated in the DTO,
-- collections/collection-sort.ts): best_selling, newest, oldest, az, za, price_asc,
-- price_desc. Additive only.
ALTER TABLE `collection` ADD COLUMN `defaultSort` VARCHAR(16) NULL;
