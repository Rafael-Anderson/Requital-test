-- Phase 2b / §6-E: the region model. This folder creates the reference table and
-- seeds it; the columns that point at it, and the backfill, are the NEXT folder.
-- Nothing here changes behaviour: no code reads `region` until the follow-up PR.
--
-- A region is the first administrative level of a country: an emirate, a
-- province, a governorate, a municipality. It is PLATFORM REFERENCE DATA, not
-- tenant data, so it has no `shopId`; what makes a region valid for a shop is
-- that its `countryCode` equals the shop's (enforced in application code).
--
-- Regions are append-only in practice. Every FK that points here is
-- ON DELETE RESTRICT, and `nameEn`/`nameAr` are corrected by a migration, never
-- by a merchant: an order shows the live name (decision D-R2).
--
-- Depth is one (decision D-R4): `parentRegionId` exists for a later city/area
-- level but nothing is seeded under it. Sub-emirate precision is the job of the
-- delivery zone's map circle and the free-text `area`.
--
-- SEED REVIEW: the UAE rows are the only ones production uses today. The other
-- five countries are dormant until a shop of that country exists, and their
-- Arabic names and ISO 3166-2 style codes want a native-speaker check.
CREATE TABLE `region` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `countryCode` CHAR(2) NOT NULL,
    -- ISO 3166-2 style, globally unique, e.g. AE-DU. Stable across environments,
    -- so seeds, tests and imports can name a region without knowing its id.
    `code` VARCHAR(16) NOT NULL,
    `nameEn` VARCHAR(100) NOT NULL,
    `nameAr` VARCHAR(100) NOT NULL,
    `parentRegionId` INTEGER NULL,
    `sortOrder` INTEGER NOT NULL DEFAULT 0,

    UNIQUE INDEX `Region_code_key`(`code`),
    UNIQUE INDEX `Region_countryCode_nameEn_key`(`countryCode`, `nameEn`),
    INDEX `Region_countryCode_sortOrder_idx`(`countryCode`, `sortOrder`),
    INDEX `Region_parentRegionId_idx`(`parentRegionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `region` ADD CONSTRAINT `Region_parentRegionId_fkey`
    FOREIGN KEY (`parentRegionId`) REFERENCES `region`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

INSERT INTO `region` (`countryCode`, `code`, `nameEn`, `nameAr`, `sortOrder`) VALUES
  ('AE', 'AE-AZ', 'Abu Dhabi',      'أبوظبي',       1),
  ('AE', 'AE-DU', 'Dubai',          'دبي',          2),
  ('AE', 'AE-SH', 'Sharjah',        'الشارقة',      3),
  ('AE', 'AE-AJ', 'Ajman',          'عجمان',        4),
  ('AE', 'AE-UQ', 'Umm Al Quwain',  'أم القيوين',   5),
  ('AE', 'AE-RK', 'Ras Al Khaimah', 'رأس الخيمة',   6),
  ('AE', 'AE-FU', 'Fujairah',       'الفجيرة',      7),

  ('SA', 'SA-01', 'Riyadh',           'الرياض',           1),
  ('SA', 'SA-02', 'Makkah',           'مكة المكرمة',      2),
  ('SA', 'SA-03', 'Madinah',          'المدينة المنورة',  3),
  ('SA', 'SA-04', 'Eastern Province', 'المنطقة الشرقية',  4),
  ('SA', 'SA-05', 'Qassim',           'القصيم',           5),
  ('SA', 'SA-06', 'Hail',             'حائل',             6),
  ('SA', 'SA-07', 'Tabuk',            'تبوك',             7),
  ('SA', 'SA-08', 'Northern Borders', 'الحدود الشمالية',  8),
  ('SA', 'SA-09', 'Jazan',            'جازان',            9),
  ('SA', 'SA-10', 'Najran',           'نجران',            10),
  ('SA', 'SA-11', 'Al Bahah',         'الباحة',           11),
  ('SA', 'SA-12', 'Al Jawf',          'الجوف',            12),
  ('SA', 'SA-14', 'Asir',             'عسير',             13),

  ('KW', 'KW-KU', 'Capital',          'العاصمة',          1),
  ('KW', 'KW-HA', 'Hawalli',          'حولي',             2),
  ('KW', 'KW-FA', 'Farwaniya',        'الفروانية',        3),
  ('KW', 'KW-AH', 'Ahmadi',           'الأحمدي',          4),
  ('KW', 'KW-JA', 'Jahra',            'الجهراء',          5),
  ('KW', 'KW-MU', 'Mubarak Al-Kabeer','مبارك الكبير',     6),

  ('QA', 'QA-DA', 'Doha',             'الدوحة',           1),
  ('QA', 'QA-RA', 'Al Rayyan',        'الريان',           2),
  ('QA', 'QA-WA', 'Al Wakrah',        'الوكرة',           3),
  ('QA', 'QA-KH', 'Al Khor',          'الخور والذخيرة',   4),
  ('QA', 'QA-MS', 'Al Shamal',        'الشمال',           5),
  ('QA', 'QA-US', 'Umm Salal',        'أم صلال',          6),
  ('QA', 'QA-ZA', 'Al Daayen',        'الضعاين',          7),
  ('QA', 'QA-SH', 'Al Shahaniya',     'الشحانية',         8),

  ('BH', 'BH-13', 'Capital',          'العاصمة',          1),
  ('BH', 'BH-15', 'Muharraq',         'المحرق',           2),
  ('BH', 'BH-17', 'Northern',         'الشمالية',         3),
  ('BH', 'BH-14', 'Southern',         'الجنوبية',         4),

  ('OM', 'OM-MA', 'Muscat',           'مسقط',             1),
  ('OM', 'OM-ZU', 'Dhofar',           'ظفار',             2),
  ('OM', 'OM-MU', 'Musandam',         'مسندم',            3),
  ('OM', 'OM-BU', 'Al Buraimi',       'البريمي',          4),
  ('OM', 'OM-DA', 'Ad Dakhiliyah',    'الداخلية',         5),
  ('OM', 'OM-BS', 'North Al Batinah', 'شمال الباطنة',     6),
  ('OM', 'OM-BJ', 'South Al Batinah', 'جنوب الباطنة',     7),
  ('OM', 'OM-SS', 'North Al Sharqiyah','شمال الشرقية',    8),
  ('OM', 'OM-SJ', 'South Al Sharqiyah','جنوب الشرقية',    9),
  ('OM', 'OM-ZA', 'Ad Dhahirah',      'الظاهرة',          10),
  ('OM', 'OM-WU', 'Al Wusta',         'الوسطى',           11);
