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
