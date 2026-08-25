-- Corrects the Slider credential model shipped in 20260825100000_slider_delivery:
-- Slider's real hierarchy is one platform-level partner API key (Requital),
-- with each merchant a customer account under that partner, identified by
-- account_id. There is no such thing as a per-shop Slider API key — the
-- encrypted sliderCredentials column was wrong and is dropped outright (no
-- backfill: the only rows ever written there were sandbox test values from
-- this same not-yet-released feature). The platform key/environment/webhook
-- token now live in env vars (SLIDER_API_KEY/SLIDER_ENVIRONMENT/
-- SLIDER_WEBHOOK_TOKEN), not the database — see CLAUDE.md.
ALTER TABLE `shop`
  DROP COLUMN `sliderCredentials`,
  ADD COLUMN `sliderAccountId` VARCHAR(64) NULL,
  ADD COLUMN `sliderEnabled` BOOLEAN NOT NULL DEFAULT FALSE;

-- Diagnostics log for the Integrations > Webhooks tab ("why didn't my order
-- update" — did the webhook even arrive). One row per inbound webhook
-- delivery this app processed (Slider + every payment gateway), written by
-- WebhookLogService.log — deliberately swallows its own write errors (same
-- philosophy as AuditLogService.log) so a broken log insert never fails the
-- real webhook processing it's describing.
CREATE TABLE `webhookevent` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `shopId` INTEGER NOT NULL,
    `source` VARCHAR(32) NOT NULL,
    `eventType` VARCHAR(64) NOT NULL,
    `result` VARCHAR(16) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE INDEX `Webhookevent_shopId_createdAt_idx` ON `webhookevent`(`shopId`, `createdAt`);

ALTER TABLE `webhookevent` ADD CONSTRAINT `Webhookevent_shopId_fkey` FOREIGN KEY (`shopId`) REFERENCES `shop`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
