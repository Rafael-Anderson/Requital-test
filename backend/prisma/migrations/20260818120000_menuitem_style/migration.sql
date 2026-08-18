-- Per-nav-item button styling (storefront-v2 Phase 1B) -- text/background
-- color, border radius preset, font weight, hover background. Optional,
-- JSON (real JSON column type, not LONGTEXT -- see CLAUDE.md's
-- notificationText postmortem for why that distinction matters).
ALTER TABLE `menuitem` ADD COLUMN `style` JSON DEFAULT NULL;
