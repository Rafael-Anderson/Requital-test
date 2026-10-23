-- G: server-side TikTok Events API and Snap Conversions API purchase events.
--
-- Two more write-only secrets beside `metaCapiTokenEnc`: AES-256-GCM ciphertext
-- via common/crypto.ts, never returned by any API, never logged, never placed
-- in a job payload or an error. NULL means "not configured". Additive only.
ALTER TABLE `shopanalytics`
    ADD COLUMN `tiktokEventsTokenEnc` TEXT NULL AFTER `tiktokPixelId`,
    ADD COLUMN `snapCapiTokenEnc` TEXT NULL AFTER `snapPixelId`;
