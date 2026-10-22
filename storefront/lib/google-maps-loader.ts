// Loads the Google Maps JS API script exactly once, client-side only. No
// @react-google-maps/api wrapper — the raw JS API (Map, Marker, Geocoder,
// places.Autocomplete) is a handful of calls and avoids a dependency that
// only wraps what we can call directly.
//
// It also tells the app WHEN Maps is not usable, so checkout can fall back to a
// typed address instead of showing Google's own error dialog (F9). A key or
// billing problem surfaces after the script has loaded, and `gm_authFailure`
// does not fire for every class (BillingNotEnabledMapError never calls it,
// confirmed live on admin 2026-08-24), so the one signal that is reliable is
// the `console.error("Google Maps JavaScript API error: <Code>...")` the Maps
// bundle writes. It is parsed here, once, the same way admin/lib/google-maps-
// loader.ts does. The code is for the merchant-facing beacon only: a shopper
// is never shown Google's text or the code (see components/MapPicker.tsx).
let loaderPromise: Promise<typeof google> | null = null;

// The closed set of runtime errors that are reported to the backend beacon.
// Mirrored by hand in backend/src/maps-health/maps-error-codes.ts.
export const MAPS_ERROR_CODES = [
  "RefererNotAllowedMapError",
  "BillingNotEnabledMapError",
  "InvalidKeyMapError",
  "ApiNotActivatedMapError",
] as const;
export type MapsErrorCode = (typeof MAPS_ERROR_CODES)[number];

// code: the recognised error, or null when Maps failed without one (the script
// did not load, or an auth failure Google did not name).
export interface MapsFailure {
  code: MapsErrorCode | null;
}

const ERROR_LINE = /Google Maps JavaScript API error: (\w+)/;

export function parseMapsErrorCode(text: string): MapsErrorCode | null | undefined {
  const match = ERROR_LINE.exec(text);
  if (!match) return undefined; // not a Maps error line at all
  return (MAPS_ERROR_CODES as readonly string[]).includes(match[1]) ? (match[1] as MapsErrorCode) : null;
}

let failure: MapsFailure | null = null;
const listeners = new Set<() => void>();

export function getMapsFailure(): MapsFailure | null {
  return failure;
}

export function subscribeMapsFailure(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// Keeps the first RECOGNISED code: gm_authFailure (no code) and the console line
// (with one) both fire for the same failure, in either order.
function reportFailure(code: MapsErrorCode | null) {
  if (failure && (failure.code !== null || code === null)) return;
  failure = { code };
  listeners.forEach((l) => l());
}

function clearFailure() {
  if (!failure) return;
  failure = null;
  listeners.forEach((l) => l());
}

let consoleErrorPatched = false;
function patchConsoleErrorForMapsFailures() {
  if (consoleErrorPatched) return;
  consoleErrorPatched = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string") {
      const code = parseMapsErrorCode(first);
      if (code !== undefined) reportFailure(code);
    }
    originalError(...args);
  };
}

// Test seam only.
export function resetMapsFailureForTests() {
  failure = null;
  loaderPromise = null;
  consoleErrorPatched = false;
  listeners.clear();
}

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser"));
  patchConsoleErrorForMapsFailures();
  (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = () => reportFailure(null);
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      loaderPromise = null;
      reportFailure(null);
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

// A later successful load (the shopper's network came back) lifts a script-level
// failure. Called by MapPicker once the Map object is actually created.
export function markMapsHealthy() {
  if (failure && failure.code === null) clearFailure();
}
