-- Phase 2a / A1: give every row that carries a money amount its own record of
-- WHICH currency that amount is denominated in.
--
-- Today exactly two columns in 80 tables carry a currency marker:
-- `shop.currency` and `orderitem.unitCostCurrency`. Everything else is a bare
-- DECIMAL whose currency is inferred by re-reading `shop.currency` live at
-- display time — which means changing a shop's currency retroactively
-- re-denominates every historical order, invoice and report that shop has ever
-- produced. The amount does not change; what it *means* does.
--
-- CHAR(3) matches the `orderitem.unitCostCurrency` precedent (migration
-- 20260921120000) rather than introducing a second convention. ISO 4217 codes
-- are exactly three characters.
--
-- EXPAND/CONTRACT per CLAUDE.md: nullable -> backfill -> NOT NULL. The backfill
-- reads each row's real owning shop rather than assuming 'AED', so it stays
-- correct if this is ever re-run against a database that already has a non-AED
-- shop. Every shop is AED today, so in practice both produce the same result —
-- the join is what makes it true by construction rather than by luck.
--
-- NOT NULL WITH NO DEFAULT, deliberately, following `order.shopOrderNumber`
-- (migration 20260923130000): an INSERT that forgets to supply a currency must
-- fail loudly at the database. A `DEFAULT 'AED'` would instead silently stamp
-- AED onto a Kuwaiti shop's order if any write path were missed — the exact
-- class of silent-wrong-money bug this whole phase exists to remove.
--
-- DELIBERATELY NOT INCLUDED: `orderitem.priceCurrency`. A line's
-- `priceAtPurchase` is always denominated in its own order's currency; there is
-- no code path that charges one line of an order in a different currency from
-- the rest. A per-line copy could therefore only ever agree with
-- `order.currency` or be a bug. This is NOT the same situation as
-- `unitCostCurrency`, which is genuinely independent: cost is what the merchant
-- PAID, which can be a different currency from the sale (imported stock). See
-- the Phase 2a plan for the full argument.

-- ── Shop-scoped rows: currency comes from the owning shop ────────────────────

ALTER TABLE `order` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `order` o JOIN `shop` s ON s.id = o.shopId SET o.currency = s.currency;
ALTER TABLE `order` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

ALTER TABLE `draftorder` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `draftorder` d JOIN `shop` s ON s.id = d.shopId SET d.currency = s.currency;
ALTER TABLE `draftorder` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

-- A gift card is a stored balance, not a one-off amount. Redeeming an AED card
-- against an order priced in SAR is a real conversion question rather than a
-- formatting one, which is why this one matters more than its row count
-- suggests.
ALTER TABLE `giftcard` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `giftcard` g JOIN `shop` s ON s.id = g.shopId SET g.currency = s.currency;
ALTER TABLE `giftcard` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

-- ── Order-scoped child rows: currency comes from the parent order ────────────
-- Neither table carries `shopId` — only `orderId` — and deriving from the order
-- is also the correct semantics: a payment and a courier fee are denominated in
-- whatever the order was priced in, not in whatever the shop is set to now.

ALTER TABLE `paymenttransaction` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `paymenttransaction` p JOIN `order` o ON o.id = p.orderId SET p.currency = o.currency;
ALTER TABLE `paymenttransaction` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

ALTER TABLE `externaldelivery` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `externaldelivery` e JOIN `order` o ON o.id = e.orderId SET e.currency = o.currency;
ALTER TABLE `externaldelivery` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

-- Frozen at issue, which is the point: `invoice-html.ts`'s money() currently
-- takes the currency from a LIVE shop join, so a merchant changing their
-- currency rewrites the denomination printed on every invoice they have already
-- issued. This column closes that on its own, ahead of the full C1 snapshot.
ALTER TABLE `invoice` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `invoice` i JOIN `order` o ON o.id = i.orderId SET i.currency = o.currency;
ALTER TABLE `invoice` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

-- ── Rollup tables ───────────────────────────────────────────────────────────
-- A single `revenue` figure is meaningless once two shops report in different
-- currencies, and these tables are read by the dashboard, the scheduled report
-- emails and the CSV exports. All three are keyed by shopId.

ALTER TABLE `dailyshopmetrics` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `dailyshopmetrics` m JOIN `shop` s ON s.id = m.shopId SET m.currency = s.currency;
ALTER TABLE `dailyshopmetrics` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

ALTER TABLE `dailyproductmetrics` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `dailyproductmetrics` m JOIN `shop` s ON s.id = m.shopId SET m.currency = s.currency;
ALTER TABLE `dailyproductmetrics` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

ALTER TABLE `customermetrics` ADD COLUMN `currency` CHAR(3) NULL;
UPDATE `customermetrics` m JOIN `shop` s ON s.id = m.shopId SET m.currency = s.currency;
ALTER TABLE `customermetrics` MODIFY COLUMN `currency` CHAR(3) NOT NULL;

-- ── Scale fix, same phase because it is the same bug class ───────────────────
-- These two are the ONLY money columns in the schema with a real scale; every
-- other one is DECIMAL(65,30). At scale 2 they silently truncate the third
-- minor digit, so an affiliate commission in KWD, BHD or OMR (1000 minor units,
-- not 100 — see common/currency-minor-units.ts) would lose its last digit on
-- write with no error. Widened to match the rest of the schema rather than to
-- (x,3), so there is one convention and not two.
-- Both are NOT NULL today (verified against the live schema, not assumed — a
-- MODIFY that omitted NOT NULL would silently relax the constraint).
ALTER TABLE `affiliatecode` MODIFY COLUMN `commissionValue` DECIMAL(65, 30) NOT NULL;
ALTER TABLE `affiliateorder` MODIFY COLUMN `commissionAmount` DECIMAL(65, 30) NOT NULL;
