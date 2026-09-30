// What a country calls its first administrative level, for the address form's
// field label. One place, served by the regions endpoints, so no frontend needs
// its own "Emirate" string. Countries without an entry have no regions seeded.
export const REGION_LABELS: Record<string, string> = {
  AE: 'Emirate',
  SA: 'Region',
  KW: 'Governorate',
  QA: 'Municipality',
  BH: 'Governorate',
  OM: 'Governorate',
};

// Shops with no country code (created before the country field, or "Other")
// were validated as UAE by the old EMIRATES check. The deprecated `emirate`
// alias keeps that meaning for them, and only for them, until the alias is
// removed. Nothing is ever persisted as a region for such a shop.
export const LEGACY_ALIAS_COUNTRY = 'AE';
