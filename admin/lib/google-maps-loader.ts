// Loads the Google Maps JS API script exactly once, client-side only. No
// @react-google-maps/api wrapper — the raw JS API (Map, Marker, Geocoder,
// places.Autocomplete) is a handful of calls and avoids a dependency that
// only wraps what we can call directly.
let loaderPromise: Promise<typeof google> | null = null;

// A billing/auth error (e.g. BillingNotEnabledMapError, confirmed hit live
// during the QA audit) surfaces after the script has already loaded
// successfully. Google's docs say the API "renders its own error dialog
// into the map div and calls `window.gm_authFailure` if defined" for
// authentication failures (InvalidKeyMapError, RefererNotAllowedMapError,
// etc.) — confirmed real and still-supported (developers.google.com/maps/
// documentation/javascript/events), just undeclared in @types/google.maps.
// **But confirmed live (2026-08-24) that gm_authFailure does NOT fire for
// BillingNotEnabledMapError specifically** — the Map object still gets
// created, `.gm-style` renders, and `google.maps.event`'s 'idle' still
// fires normally (Google paints a watermarked/degraded map rather than
// hard-failing), so neither gm_authFailure nor an 'idle'-based timeout ever
// catches it. What DOES reliably fire, verified by inspecting the actual
// console.error call args in a real browser: a single-argument
// `console.error("Google Maps JavaScript API error: <ErrorCode>\n<url>")`
// from the Maps JS bundle itself, for every error class including this one.
// Patched once here (idempotent) so every current and future error type
// routes through the same `gm_authFailure` callback every consumer already
// wires up, instead of requiring each new error class to be special-cased.
let consoleErrorPatched = false;
function patchConsoleErrorForMapsFailures() {
  if (consoleErrorPatched) return;
  consoleErrorPatched = true;
  const originalError = console.error.bind(console);
  console.error = (...args: unknown[]) => {
    const first = args[0];
    if (typeof first === "string" && first.startsWith("Google Maps JavaScript API error")) {
      (window as unknown as { gm_authFailure?: () => void }).gm_authFailure?.();
    }
    originalError(...args);
  };
}

// `onAuthFailure` is re-registered on every call, not just the one that
// injects the script, so a MapPicker mounting after the script is already
// cached still gets its own failure callback wired up. Last-registered
// caller wins if more than one map is mounted at once — acceptable here
// since this app never shows two maps simultaneously.
export function loadGoogleMaps(onAuthFailure?: () => void): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser"));
  patchConsoleErrorForMapsFailures();
  if (onAuthFailure) {
    (window as unknown as { gm_authFailure?: () => void }).gm_authFailure = onAuthFailure;
  }
  if (window.google?.maps) return Promise.resolve(window.google);
  if (loaderPromise) return loaderPromise;

  loaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY}&libraries=places`;
    script.async = true;
    script.onload = () => resolve(window.google);
    script.onerror = () => {
      loaderPromise = null;
      reject(new Error("Failed to load Google Maps"));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

