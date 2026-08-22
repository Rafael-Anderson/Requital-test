// Loads the Google Maps JS API script exactly once, client-side only. No
// @react-google-maps/api wrapper — the raw JS API (Map, Marker, Geocoder,
// places.Autocomplete) is a handful of calls and avoids a dependency that
// only wraps what we can call directly.
let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (typeof window === "undefined") return Promise.reject(new Error("Google Maps can only load in the browser"));
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
