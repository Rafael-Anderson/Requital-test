-- Product page "Additional information" accordion blocks (storefront-v2
-- Phase 3D) -- an ordered list of {title, body (rich text HTML), visible}
-- blocks, admin-authored per product. JSON, same convention as every other
-- free-form structured field on this table (giftCardDenominations, etc.).
ALTER TABLE `product` ADD COLUMN `additionalInfo` JSON DEFAULT NULL;
