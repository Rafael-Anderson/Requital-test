-- Phase 2a / A2: an exchange-rate table, and a rate frozen onto every order at
-- the moment it is created.
--
-- There was no rate infrastructure of any kind before this — no table, no
-- column, no unused field, no vestigial remnant. This is genuinely greenfield,
-- so the shape is chosen rather than inherited.
--
-- WHY A STATIC TABLE AND NOT A LIVE FX API. Of the seven currencies this
-- platform offers, five are hard USD pegs that have not moved in decades (AED
-- since 1997, plus SAR, QAR, BHD, OMR), one is the USD itself, and KWD is pegged
-- to an undisclosed basket that drifts under ~1% a year. For that set, a live
-- rates integration would add an API key to manage, a staleness policy, and a
-- failure path inside order creation, to track numbers that are constants in
-- practice. A manually-maintained table is not a shortcut here; it is the
-- correct amount of machinery. Revisit if a genuinely floating currency is ever
-- added — the `updatedAt` column is what would make staleness visible.
--
-- NO shopId, DELIBERATELY. An FX rate is a platform fact, not a tenant one.
-- A per-shop rate would let a merchant set their own conversion and thereby
-- mis-state their own revenue, and would make cross-tenant reporting
-- incomparable. Maintained by Requital staff through the /platform-admin tier,
-- with every change written to platformauditlogentry.

CREATE TABLE `currencyrate` (
  -- Always the platform base (USD today, see currency-rates.constants.ts).
  -- Stored rather than assumed so a future change of base is a data migration
  -- with a readable history, not a silent reinterpretation of every stored rate.
  `baseCurrency` CHAR(3) NOT NULL,
  `quoteCurrency` CHAR(3) NOT NULL,
  -- Units of quoteCurrency per 1 baseCurrency. DECIMAL(20,10) because the
  -- three-decimal currencies need real precision on the way back to base and
  -- because a rate is not money — it must not share the money columns'
  -- DECIMAL(65,30) convention, which would imply it is an amount.
  `rate` DECIMAL(20, 10) NOT NULL,
  `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  -- Null for the seeded rows below: nobody set them, the migration did.
  `updatedByPlatformAdminId` INT NULL,
  PRIMARY KEY (`baseCurrency`, `quoteCurrency`)
) DEFAULT CHARACTER SET utf8mb4;

-- The published pegs. KWD is the one that genuinely moves; the rest have been
-- fixed for decades. Seeded so the table is never empty on a fresh database —
-- an empty table would make every order capture a NULL rate and quietly look
-- like the feature was not deployed.
INSERT INTO `currencyrate` (`baseCurrency`, `quoteCurrency`, `rate`) VALUES
  ('USD', 'USD', 1.0000000000),
  ('USD', 'AED', 3.6725000000),
  ('USD', 'SAR', 3.7500000000),
  ('USD', 'QAR', 3.6400000000),
  ('USD', 'BHD', 0.3760000000),
  ('USD', 'OMR', 0.3845000000),
  -- Basket-pegged, not USD-pegged. This is the only seeded value that should be
  -- reviewed periodically rather than treated as a constant.
  ('USD', 'KWD', 0.3070000000);

-- ── Capture on the order ────────────────────────────────────────────────────
-- The rate an order was created under, frozen. Same discipline as
-- priceAtPurchase and orderitem.unitCost: a later rate change must never
-- retroactively restate a historical order, because the invoice has to keep
-- adding up forever.

ALTER TABLE `order` ADD COLUMN `rateBaseCurrency` CHAR(3) NULL;
ALTER TABLE `order` ADD COLUMN `exchangeRate` DECIMAL(20, 10) NULL;

-- BOTH NULLABLE AND DELIBERATELY NOT BACKFILLED. Every order placed before this
-- migration genuinely has no captured rate. The AED/USD peg has been 3.6725
-- throughout, so a backfill would even produce the arithmetically right number —
-- and it would still be a fabrication, because "the rate this order used" and
-- "the rate that happened to exist that day" are different claims and only the
-- first one belongs in this column. NULL means "not captured", exactly as
-- orderitem.unitCost's own migration argued for cost, and consumers must treat
-- it as unknown rather than as 1 or as today's rate.
--
-- This is also why the column is not NOT NULL: unlike `currency` (A1), there is
-- no correct value to write for history, so a loud failure on insert would have
-- to be paid for with a lie in the backfill.
