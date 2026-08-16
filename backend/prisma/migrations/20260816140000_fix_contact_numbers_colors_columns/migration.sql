-- Same LONGTEXT-vs-JSON bug as notificationText
-- (20260816130000_fix_notification_text_column), on the two sibling
-- columns that fix explicitly left out of scope. Confirmed live: unmasked
-- by that fix on arabian-petals-com/paradise (both had a stringified empty
-- contactNumbers array), throwing "e.contactNumbers?.map is not a
-- function" in storefront/components/Footer.tsx.
--
-- Order matters, same reasoning as the notificationText migration:
-- sanitize non-JSON values to NULL FIRST, while each column is still
-- LONGTEXT (so any string content is allowed) — MySQL validates every
-- existing value against the target type during MODIFY COLUMN ... JSON, so
-- running the ALTER first would abort on the first row holding non-JSON
-- text instead of converting it. Every row in this table today already
-- holds valid JSON (checked directly on the VPS before writing this), so
-- both UPDATEs below are no-ops in practice right now — they're here so
-- this migration stays safe against any row this repo's own tooling
-- hasn't seen.
UPDATE themesettings
SET contactNumbers = NULL
WHERE contactNumbers IS NOT NULL
  AND JSON_VALID(contactNumbers) = 0;

UPDATE themesettings
SET colors = NULL
WHERE colors IS NOT NULL
  AND JSON_VALID(colors) = 0;

-- Now safe: every remaining non-null value is confirmed valid JSON text, so
-- MySQL converts each one to the real JSON document it represents (array
-- for contactNumbers, object for colors) as part of the column type change
-- itself — no separate backfill UPDATE needed afterward.
ALTER TABLE themesettings
  MODIFY COLUMN contactNumbers JSON NULL;

ALTER TABLE themesettings
  MODIFY COLUMN colors JSON NULL;
