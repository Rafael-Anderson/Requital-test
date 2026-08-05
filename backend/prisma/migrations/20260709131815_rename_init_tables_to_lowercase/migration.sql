-- Renames the 8 PascalCase tables created by `init` to the lowercase names
-- every later migration expects (see CLAUDE.md's "Prisma model naming" note).
--
-- On a case-sensitive MySQL host (Linux, lower_case_table_names=0) `init`
-- genuinely created tables named `Shop`, `User`, etc., so the plain rename
-- below is real and necessary there.
--
-- On a case-insensitive host (Windows dev, lower_case_table_names=1) MySQL
-- already folded those names to lowercase at CREATE TABLE time in `init` --
-- there the PascalCase source table never exists, so an unguarded
-- `RENAME TABLE Shop TO shop` errors with 1050 "Table 'shop' already exists"
-- on every pre-existing dev/staging database (confirmed empirically
-- 2026-08-05 against a database seeded with the full migration history
-- minus this one). Each rename is guarded by an information_schema
-- existence check and becomes a no-op when the source table isn't there.
-- The check must use BINARY: information_schema.tables.table_name compares
-- with a case-insensitive collation by default, so an unguarded
-- `table_name = 'Shop'` matches the already-lowercase `shop` table too and
-- the guard would wrongly fire the rename anyway (also confirmed
-- empirically 2026-08-05 -- the first guarded version still errored).

SET @dbname = DATABASE();

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'Shop'),
  'RENAME TABLE `Shop` TO `shop`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'User'),
  'RENAME TABLE `User` TO `user`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'Product'),
  'RENAME TABLE `Product` TO `product`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'ProductVariant'),
  'RENAME TABLE `ProductVariant` TO `productvariant`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'Order'),
  'RENAME TABLE `Order` TO `order`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'OrderItem'),
  'RENAME TABLE `OrderItem` TO `orderitem`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'PaymentTransaction'),
  'RENAME TABLE `PaymentTransaction` TO `paymenttransaction`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @stmt := (SELECT IF(
  EXISTS(SELECT 1 FROM information_schema.tables WHERE table_schema = @dbname AND BINARY table_name = 'ThemeSettings'),
  'RENAME TABLE `ThemeSettings` TO `themesettings`',
  'DO 0'
));
PREPARE stmt FROM @stmt;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
