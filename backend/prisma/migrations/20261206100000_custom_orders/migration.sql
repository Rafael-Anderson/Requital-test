-- JOB B: admin custom orders, built on the existing draft orders. Additive only:
-- every new column is NULL (unknown / not applicable) or has a default that keeps
-- existing rows meaning exactly what they meant before. Nothing is backfilled.

-- 1. The draft: what the builder can now hold, and the payment link.
--    payToken: the 128-bit (32 hex) credential of /pay/<token>; NULL = no link.
--    snapshotJson: the priced bill frozen when the link is created or re-locked
--      (lines, delivery fee, discount, tax, total, currency); the pay page and the
--      conversion read it, never the live catalogue.
--    deliveryFeeOverride + reason: NULL = the fee the shop's delivery zones give.
--    orderDiscountType/Value/Reason: a staff discount (percent | fixed); NULL = none.
--    notes stays the INTERNAL note (it never reached an order); customerNote is new.
--    createdByUserId: the staff user who created the draft.
ALTER TABLE `draftorder`
  ADD COLUMN `payToken` CHAR(32) NULL,
  ADD COLUMN `payLinkSentAt` DATETIME(3) NULL,
  ADD COLUMN `payLinkExpiresAt` DATETIME(3) NULL,
  ADD COLUMN `snapshotJson` JSON NULL,
  ADD COLUMN `snapshotAt` DATETIME(3) NULL,
  ADD COLUMN `convertingAt` DATETIME(3) NULL,
  ADD COLUMN `deliveryFeeOverride` DECIMAL(65, 30) NULL,
  ADD COLUMN `deliveryFeeOverrideReason` VARCHAR(255) NULL,
  ADD COLUMN `orderDiscountType` VARCHAR(10) NULL,
  ADD COLUMN `orderDiscountValue` DECIMAL(65, 30) NULL,
  ADD COLUMN `orderDiscountReason` VARCHAR(255) NULL,
  ADD COLUMN `customerNote` TEXT NULL,
  ADD COLUMN `receiverName` VARCHAR(191) NULL,
  ADD COLUMN `receiverPhone` VARCHAR(191) NULL,
  ADD COLUMN `receiverMessage` TEXT NULL,
  ADD COLUMN `deliveryDate` VARCHAR(10) NULL,
  ADD COLUMN `deliveryTimeSlot` VARCHAR(50) NULL,
  ADD COLUMN `createdByUserId` INTEGER NULL,
  ADD UNIQUE INDEX `draftorder_payToken_key`(`payToken`),
  ADD INDEX `draftorder_shopId_status_idx`(`shopId`, `status`);

-- 2. Draft lines: a custom item (not a catalogue product) and the reason for a
--    manual price. A custom line points at one of the shop's two system "custom
--    item" carrier products (taxable / not taxable), so every order reader keeps
--    working unchanged; its own name is carried on the line.
ALTER TABLE `draftorderitem`
  ADD COLUMN `isCustom` TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN `taxable` TINYINT(1) NULL,
  ADD COLUMN `priceOverrideReason` VARCHAR(255) NULL;

-- 3. The carrier products. NULL = an ordinary product; 'custom_item' and
--    'custom_item_untaxed' are created by the application on first use, are never
--    Available (so never on the storefront) and are hidden from admin lists.
ALTER TABLE `product`
  ADD COLUMN `systemRole` VARCHAR(30) NULL;

-- 4. The order an admin-created draft became. All NULL for every other order.
--    adminSource: 'payment_link' | 'cod' | 'marked_paid'.
--    manualPaymentMethod: 'cash' | 'bank_transfer' | 'card_terminal' | 'other'
--      (Mark as paid only), with an optional reference.
ALTER TABLE `order`
  ADD COLUMN `draftOrderId` INTEGER NULL,
  ADD COLUMN `createdByUserId` INTEGER NULL,
  ADD COLUMN `adminSource` VARCHAR(20) NULL,
  ADD COLUMN `manualPaymentMethod` VARCHAR(20) NULL,
  ADD COLUMN `manualPaymentReference` VARCHAR(191) NULL,
  ADD INDEX `order_draftOrderId_idx`(`draftOrderId`);
