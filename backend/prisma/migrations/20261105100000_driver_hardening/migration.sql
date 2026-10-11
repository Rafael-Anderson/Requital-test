-- W5 driver hardening. Data-only, no schema change.
--
-- 1) Proof photos are private. The stored public URL is dropped: the key
--    (proofPhotoKey) is kept, so no photo is lost and staff read it through the
--    authenticated GET /delivery-runs/:id/stops/:stopId/proof-photo. The column
--    stays (nothing reads or writes a value into it any more).
UPDATE `deliveryrunstop` SET `proofPhotoUrl` = NULL WHERE `proofPhotoUrl` IS NOT NULL;

-- 2) Finished driver-link WhatsApp and delivery-code email jobs held the live
--    magic URL / one-time code in job.payload. Scrub the text of every one that is
--    no longer needed (not pending/processing). JSON_REPLACE is a no-op for a path
--    the payload does not have.
UPDATE `job`
   SET `payload` = JSON_SET(
         JSON_REPLACE(JSON_REPLACE(JSON_REPLACE(`payload`, '$.body', '[scrubbed]'), '$.bodyText', '[scrubbed]'), '$.html', '[scrubbed]'),
         '$.scrubbed', TRUE)
 WHERE `status` IN ('completed', 'dead_letter', 'dismissed')
   AND (`idempotencyKey` LIKE 'driver-link:%' OR `idempotencyKey` LIKE 'delivery-code:%');
