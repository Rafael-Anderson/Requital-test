-- MKT-4: per-shop analytics / ad-pixel configuration, one row per shop.
--
-- Everything here except `metaCapiTokenEnc` is a PUBLIC identifier by design
-- (a GA4 measurement id, a Meta pixel id and so on are embedded in every
-- storefront page's source for any visitor to read), which is why the storefront
-- payload may expose them. `metaCapiTokenEnc` is the one secret: the Meta
-- Conversions API access token, AES-256-GCM encrypted via common/crypto.ts, never
-- returned by any API. `metaTestEventCode` is server-only (it routes CAPI events
-- to the merchant's Test Events tab) and is never put in the public payload.
--
-- Every column is nullable and NULL means "not configured": no default is ever
-- invented for an id. The row itself is created lazily on first save, so a shop
-- that never opens the page has no row and the storefront loads nothing.
CREATE TABLE `shopanalytics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `ga4MeasurementId` VARCHAR(32) NULL,
    `metaPixelId` VARCHAR(32) NULL,
    `metaCapiTokenEnc` TEXT NULL,
    `metaTestEventCode` VARCHAR(64) NULL,
    `tiktokPixelId` VARCHAR(64) NULL,
    `snapPixelId` VARCHAR(64) NULL,
    `googleAdsConversionId` VARCHAR(32) NULL,
    `googleAdsConversionLabel` VARCHAR(64) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `ShopAnalytics_shopId_key`(`shopId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `shopanalytics` ADD CONSTRAINT `ShopAnalytics_shopId_fkey`
    FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
