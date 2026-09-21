-- Captures what a line item COST at order time, the mirror of the
-- priceAtPurchase column two rows up: what it sold for, and what it cost,
-- both frozen at the moment of sale.
--
-- Why this exists at all: margin reporting previously had to read
-- product.costPrice at report time, which reports TODAY's cost against a
-- historical sale and silently rewrites every past report the moment a
-- merchant edits a cost. Capturing at order time is the only way the number
-- stays true.
--
-- Nullable, and deliberately NOT backfilled. Every order placed before this
-- migration genuinely has no captured cost, and filling those rows from
-- today's product.costPrice would fabricate history that looks authoritative
-- and is wrong. Margin is reported from this date forward; the report says so
-- rather than showing a misleading total. This is also why the capability
-- audit calls it urgent - the data can only start accruing once it ships.
--
-- DECIMAL(65, 30) matches priceAtPurchase and autoDiscountAmount on this same
-- table, so unitCost flows through the existing trimDecimal() handling at the
-- API boundary rather than becoming a second convention (see CLAUDE.md on
-- unannotated-scale decimal columns).
ALTER TABLE `orderitem`
  ADD COLUMN `unitCost` DECIMAL(65, 30) NULL;

-- The currency the captured cost is denominated in. This app is
-- single-currency (AED) today, but true multi-currency is a committed
-- decision (audit D6), and a cost figure with no currency marker is
-- ambiguous the instant that lands - at which point every historical row
-- would need a migration that can only guess. NOT NULL with a default, not
-- nullable-and-unset: an absent currency is not a meaningful state, and
-- existing rows are genuinely AED because nothing else has ever been
-- possible. MySQL applies the default to existing rows as part of this
-- ADD COLUMN, so no separate backfill statement is needed.
ALTER TABLE `orderitem`
  ADD COLUMN `unitCostCurrency` CHAR(3) NOT NULL DEFAULT 'AED';
