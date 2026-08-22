// Loads the Google Maps JS API script exactly once, client-side only. No
// @react-google-maps/api wrapper — the raw JS API (Map, Marker, Geocoder,
// places.Autocomplete) is a handful of calls and avoids a dependency that
// only wraps what we can call directly.
let loaderPromise: Promise<typeof google> | null = null;

// A billing/auth error (e.g. BillingNotEnabledMapError, confirmed hit live
// during the QA audit) surfaces after the script has already loaded
// successfully — the API renders its own error dialog into the map div and
// calls `window.gm_authFailure` if defined. Confirmed against Google's own
// current Maps JS API docs (developers.google.com/maps/documentation/
// javascript/events, "if the following global function is defined it will
// be called when the authentication fails") — a real, still-supported
// mechanism, not inferred; @types/google.maps just has no declaration for
// it. `onAuthFailure` is re-registered on every call, not just the one that
// injects the script, so a MapPicker mounting after the script is already
// cached still gets its own failure callback wired up. Last-registered
// caller wins if more than one map is mounted at once — acceptable here
// since this app never shows two maps simultaneously.
export function loadGoogleMaps(onAuthFailure?: () => void): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser"));
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
