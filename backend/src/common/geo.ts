const EARTH_RADIUS_KM = 6371;

// Great-circle distance between two lat/lng points, in kilometers. Used to
// check a customer's coordinates against an outlet's deliveryRadiusKm — the
// first consumer of that field since it was added (previously captured and
// displayed only).
export function haversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// A coordinate pair usable as a real point: both finite numbers, in range, and
// not the (0, 0) a missing value is often coerced to. The only "is this a pin"
// test the dropoff-pin code uses, at write and again at read.
export function isUsablePin(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
