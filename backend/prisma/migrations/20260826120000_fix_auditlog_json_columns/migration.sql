-- auditlog.before/after/metadata were declared JSON in their creation
-- migration (20260726200000_audit_log) but drifted to `longtext` on the live
-- database — confirmed via information_schema.columns, and confirmed the
-- server itself is real MySQL 8.0, not a MariaDB JSON-is-LONGTEXT-alias
-- situation. mysql2 only auto-parses a column whose real type is JSON, so
-- every `after` value was coming back as a raw JSON-text string instead of a
-- parsed object — OrdersService.getHistory()'s `(e.after as
-- {status?:string})?.status` silently evaluated to undefined for every
-- logged transition, rendering as "Unknown" in the admin order status
-- timeline. Same bug class as job.payload and
-- themesettings.notificationText/contactNumbers/colors (see CLAUDE.md).
--
-- Sanitize first (MySQL validates every existing value against JSON at
-- ALTER time) — confirmed via JSON_VALID() that every row on the live DB is
-- already valid JSON, but keep this for any other environment.
UPDATE `auditlog` SET `before` = NULL WHERE `before` IS NOT NULL AND JSON_VALID(`before`) = 0;
UPDATE `auditlog` SET `after` = NULL WHERE `after` IS NOT NULL AND JSON_VALID(`after`) = 0;
UPDATE `auditlog` SET `metadata` = NULL WHERE `metadata` IS NOT NULL AND JSON_VALID(`metadata`) = 0;

ALTER TABLE `auditlog`
  MODIFY COLUMN `before` JSON NULL,
  MODIFY COLUMN `after` JSON NULL,
  MODIFY COLUMN `metadata` JSON NULL;
