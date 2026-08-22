-- Persists the per-line auto-discount amount applied at order-creation time
-- (see ProductsService.resolveOrderItems / DiscountsService.findBestAutoDiscountAmount),
-- mirroring how order-level discountAmount already works for code-based
-- discounts. Nullable: NULL means no auto-discount applied to this line,
-- distinct from a real 0-amount discount.
ALTER TABLE `orderitem`
  ADD COLUMN `autoDiscountAmount` DECIMAL(65, 30) NULL;
