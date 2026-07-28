-- Footer structural layout options + header/footer height density —
-- independent dimensions (arrangement vs. size), see schema.prisma's
-- comments on themesettings.footerLayout/headerDensity/footerDensity.

ALTER TABLE `themesettings`
  ADD COLUMN `footerLayout` VARCHAR(191) NOT NULL DEFAULT 'columns',
  ADD COLUMN `headerDensity` VARCHAR(191) NOT NULL DEFAULT 'regular',
  ADD COLUMN `footerDensity` VARCHAR(191) NOT NULL DEFAULT 'regular';
