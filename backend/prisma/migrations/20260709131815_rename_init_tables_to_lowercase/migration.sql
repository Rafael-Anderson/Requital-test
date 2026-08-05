-- Renames the 8 tables created by 20260709131814_init from PascalCase to
-- the lowercase names every migration since (and the current Prisma
-- schema, which has never had a `@@map`) already assumes — see CLAUDE.md's
-- "Prisma model naming" note. This only ever worked locally because
-- Windows MySQL folds table-name case (lower_case_table_names=1); a
-- genuinely case-sensitive MySQL (Linux default, lower_case_table_names=0)
-- treats `Product` and `product` as different tables, which is exactly
-- what this session's CI pipeline's first-ever clean `migrate deploy`
-- surfaced as a P3018 ("Table 'shop_manager.product' doesn't exist") on
-- the very next migration after init. Single atomic RENAME TABLE so
-- MySQL updates every cross-table foreign key reference consistently.
RENAME TABLE
    `Shop` TO `shop`,
    `User` TO `user`,
    `Product` TO `product`,
    `ProductVariant` TO `productvariant`,
    `Order` TO `order`,
    `OrderItem` TO `orderitem`,
    `PaymentTransaction` TO `paymenttransaction`,
    `ThemeSettings` TO `themesettings`;
