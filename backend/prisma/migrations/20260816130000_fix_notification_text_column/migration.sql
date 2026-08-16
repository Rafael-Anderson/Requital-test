-- themesettings.notificationText was LONGTEXT, not a real JSON column — the
-- write path (theme.service.ts's THEME_JSON_COLUMNS) always JSON.stringify()'d
-- the array before storing it, but LONGTEXT has no JSON validation/parsing
-- semantics at insert time (unlike a real JSON column, which parses a
-- JSON-text string back into the actual document it represents), and
-- nothing on the read side ever called JSON.parse() either. Every consumer
-- therefore got the raw JSON-encoded string back instead of an array —
-- crashing storefront/components/AnnouncementBar.tsx's messages.join() for
-- any shop with a non-null value (confirmed live for shopId 11 and 12;
-- shopId 4 and 10 had a stringified empty array and would crash the same
-- way the moment they got a real message). Same bug class this codebase's
-- job.payload has already hit once before (see CLAUDE.md).
--
-- Order matters: sanitize non-JSON values to NULL FIRST, while the column
-- is still LONGTEXT (so any string content is allowed). MySQL validates
-- every existing value against the target type as part of MODIFY COLUMN
-- ... JSON — running the ALTER before this UPDATE would abort the whole
-- migration on the first row holding non-JSON text instead of converting
-- it. Every row this codebase has today happens to already hold valid JSON
-- (checked directly on the VPS before writing this), so this UPDATE is a
-- no-op in practice right now — it's here so this migration stays safe
-- against any row this repo's own tooling hasn't seen.
UPDATE themesettings
SET notificationText = NULL
WHERE notificationText IS NOT NULL
  AND JSON_VALID(notificationText) = 0;

-- Now safe: every remaining non-null value is confirmed valid JSON text, so
-- MySQL parses and converts each one to the real JSON document it
-- represents as part of the column type change itself (e.g. the LONGTEXT
-- value '["a","b"]' becomes the real JSON array ["a","b"]) — no separate
-- backfill UPDATE is needed afterward, and running a CAST(... AS JSON)
-- UPDATE after this ALTER would be a no-op at best (the column is already
-- JSON) since MySQL already performed that conversion for every row above.
ALTER TABLE themesettings
  MODIFY COLUMN notificationText JSON NULL;
