-- Theme Customizer v2 — curated layout/icon/button presets. All NOT NULL
-- with a DEFAULT matching current (pre-this-task) storefront behavior, same
-- backfill-in-the-same-statement pattern as 20260725150000_theme_homepage_layout.
ALTER TABLE `themesettings`
  ADD COLUMN `topBarLayout` VARCHAR(191) NOT NULL DEFAULT 'logo_left',
  ADD COLUMN `iconStyle` VARCHAR(191) NOT NULL DEFAULT 'outline',
  ADD COLUMN `buttonRadius` VARCHAR(191) NOT NULL DEFAULT 'rounded',
  ADD COLUMN `buttonFill` VARCHAR(191) NOT NULL DEFAULT 'solid',
  ADD COLUMN `pdpLayout` VARCHAR(191) NOT NULL DEFAULT 'gallery_left',
  ADD COLUMN `cartLayout` VARCHAR(191) NOT NULL DEFAULT 'full_page',
  ADD COLUMN `checkoutLayout` VARCHAR(191) NOT NULL DEFAULT 'single_page';
