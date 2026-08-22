-- Auto-apply discounts (no code required), additive to the existing
-- code-based discount model. `code` becomes nullable for this -- multiple
-- `discountType = 'auto'` rows with a NULL code coexist fine under the
-- existing `Discount_shopId_code_key` unique index: InnoDB treats every
-- NULL as distinct from every other NULL, so no index change is needed.
ALTER TABLE `discount`
  MODIFY COLUMN `code` VARCHAR(191) NULL,
  ADD COLUMN `discountType` VARCHAR(191) NOT NULL DEFAULT 'code';
