-- Slider on-demand delivery integration. `externaldelivery` already covers
-- "a courier handled this order" generically (manual carrier logging,
-- 20260724210000_external_delivery); `provider` distinguishes a manual log
-- entry (existing behavior, default) from one created via the Slider API, and
-- the new columns hold what only a real provider integration can populate
-- (Slider's own order id, live tracking link, driver contact/location, an
-- ETA). vehicleType/price/destination/status already exist and are reused
-- as-is (Slider's fare and address feed those same columns).
ALTER TABLE `externaldelivery`
  ADD COLUMN `provider` VARCHAR(16) NOT NULL DEFAULT 'manual',
  ADD COLUMN `sliderOrderNumber` BIGINT NULL,
  ADD COLUMN `trackingUrl` VARCHAR(255) NULL,
  ADD COLUMN `driverName` VARCHAR(255) NULL,
  ADD COLUMN `driverPhone` VARCHAR(32) NULL,
  ADD COLUMN `driverLat` DECIMAL(10, 6) NULL,
  ADD COLUMN `driverLng` DECIMAL(10, 6) NULL,
  ADD COLUMN `estimatedDeliveryMinutes` INT NULL;

-- Per-shop Slider credentials, encrypted at rest — same one-slot-on-shop
-- shape as shop.whatsappCredentials (a single pluggable integration, not a
-- merchant choice among several providers yet, see WhatsAppSettingsService's
-- own comment for the reasoning this mirrors). Bundles apiKey/accountId/
-- webhookToken/environment into one encrypted JSON blob rather than one
-- column per field — environment must be read alongside apiKey to pick the
-- sandbox/production base URL, and every real caller already needs the
-- decrypted credentials anyway, so there's no read path that benefits from
-- environment being a separate plaintext column.
ALTER TABLE `shop`
  ADD COLUMN `sliderCredentials` TEXT NULL;
