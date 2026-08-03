import { BadRequestException, NotFoundException } from '@nestjs/common';

// Shared by the admin outlet-address lookup and the public storefront
// delivery-address lookup — same policy reasoning applies to both: Nominatim
// requires a descriptive User-Agent and disallows anonymous client-side
// traffic, so both callers proxy through the backend rather than hitting
// this from the browser directly.
const NOMINATIM_USER_AGENT = 'Requital/1.0 (address lookup)';

export interface GeocodeResult {
  latitude: number;
  longitude: number;
  displayName: string;
}

export interface ReverseGeocodeResult {
  displayName: string;
}

export async function geocodeAddress(query?: string): Promise<GeocodeResult> {
  if (!query?.trim()) {
    throw new BadRequestException('A search query is required');
  }
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(query)}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
  } catch {
    throw new BadRequestException('Geocoding lookup failed — try again');
  }
  if (!res.ok) {
    throw new BadRequestException('Geocoding lookup failed — try again');
  }
  const results = (await res.json()) as {
    lat: string;
    lon: string;
    display_name: string;
  }[];
  if (results.length === 0) {
    // A bare `return null` here would serialize as an empty response body
    // (no Content-Type, Content-Length: 0) rather than the JSON literal
    // `null` — the frontend's unconditional `res.json()` would then throw
    // "Unexpected end of JSON input". A real 404 always gets a proper JSON
    // body from Nest's exception filter.
    throw new NotFoundException('No location found for that search');
  }
  return {
    latitude: Number(results[0].lat),
    longitude: Number(results[0].lon),
    displayName: results[0].display_name,
  };
}

// Lat/lng -> address, for the map pin-drag flow (MapPicker). Same proxy
// rationale as geocodeAddress above — one User-Agent-compliant call site,
// reused by both the admin outlet editor and the public storefront.
export async function reverseGeocodeAddress(
  lat?: number,
  lon?: number,
): Promise<ReverseGeocodeResult> {
  if (
    typeof lat !== 'number' ||
    typeof lon !== 'number' ||
    Number.isNaN(lat) ||
    Number.isNaN(lon)
  ) {
    throw new BadRequestException('lat and lon are required');
  }
  const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`;
  let res: Response;
  try {
    res = await fetch(url, { headers: { 'User-Agent': NOMINATIM_USER_AGENT } });
  } catch {
    throw new BadRequestException(
      'Reverse geocoding lookup failed — try again',
    );
  }
  if (!res.ok) {
    throw new BadRequestException(
      'Reverse geocoding lookup failed — try again',
    );
  }
  const result = (await res.json()) as {
    display_name?: string;
    error?: string;
  };
  if (!result.display_name) {
    throw new NotFoundException('No address found for that location');
  }
  return { displayName: result.display_name };
}
