// The closed set of Google Maps JS API runtime errors a storefront may report.
// Mirrored by hand in storefront/lib/google-maps-loader.ts (the two apps share
// no code). Anything else is rejected, so the table cannot grow from free text.
export const MAPS_ERROR_CODES = [
  'RefererNotAllowedMapError',
  'BillingNotEnabledMapError',
  'InvalidKeyMapError',
  'ApiNotActivatedMapError',
] as const;

export type MapsErrorCode = (typeof MAPS_ERROR_CODES)[number];

// A beacon only counts for a hostname that is the shop's own (see
// shopOwnHosts); the port and case are not part of the identity.
export function normalizeBeaconHost(raw: string): string {
  return raw.trim().toLowerCase().replace(/:\d+$/, '');
}
