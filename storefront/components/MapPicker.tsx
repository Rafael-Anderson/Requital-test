"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps, markMapsHealthy } from "@/lib/google-maps-loader";
import { geocodeAddress } from "@/lib/api";
import { useMapsFailure } from "@/lib/maps-status";
import { BUTTON_OUTLINE_CLASS } from "@/lib/form-styles";

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }, address: string | null) => void;
  className?: string;
  // Enables the Maps-unavailable fallback: the shop (for the "Find on map"
  // lookup and the merchant-facing error beacon) and the address text the
  // shopper has typed so far (what "Find on map" looks up).
  shopSlug?: string;
  addressQuery?: string;
}

// Dubai — only used as the initial map center when no coordinates exist yet
// (a brand-new address); never sent anywhere as a real value.
const DEFAULT_CENTER = { lat: 25.2048, lng: 55.2708 };

// Our own words only. Never Google's error text, and never anything about keys,
// billing or referrers: the shopper cannot act on those, and the merchant is told
// separately (admin MapsHealthBanner).
export const MAPS_UNAVAILABLE_MESSAGE = "Map unavailable. You can type your address below.";

export default function MapPicker({
  latitude,
  longitude,
  onPick,
  className = "",
  shopSlug,
  addressQuery = "",
}: MapPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);
  const mapsFailure = useMapsFailure(shopSlug);
  const unavailable = failed || mapsFailure !== null;
  const [finding, setFinding] = useState(false);
  const [found, setFound] = useState<string | null>(null);
  const [findError, setFindError] = useState<string | null>(null);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  // Init map + marker + autocomplete once, client-side only.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps()
      .then((g) => {
        if (cancelled || !mapDivRef.current) return;
        const position = latitude !== null && longitude !== null ? { lat: latitude, lng: longitude } : DEFAULT_CENTER;
        const map = new g.maps.Map(mapDivRef.current, {
          center: position,
          zoom: latitude !== null ? 15 : 11,
          streetViewControl: false,
          mapTypeControl: false,
          fullscreenControl: false,
        });
        const marker = new g.maps.Marker({ position, map, draggable: true });
        const geocoder = new g.maps.Geocoder();
        marker.addListener("dragend", () => {
          const pos = marker.getPosition();
          if (!pos) return;
          const coords = { latitude: pos.lat(), longitude: pos.lng() };
          // Update coordinates immediately (no snap-back while the
          // reverse-geocode round trip is in flight), then patch the
          // address text in once it resolves.
          onPickRef.current(coords, null);
          geocoder.geocode({ location: pos }, (results, status) => {
            if (status === "OK" && results?.[0]) onPickRef.current(coords, results[0].formatted_address);
          });
        });
        mapRef.current = map;
        markerRef.current = marker;

        if (inputRef.current) {
          const autocomplete = new g.maps.places.Autocomplete(inputRef.current, {
            fields: ["geometry", "formatted_address"],
          });
          autocomplete.addListener("place_changed", () => {
            const place = autocomplete.getPlace();
            const loc = place.geometry?.location;
            if (!loc) return;
            const coords = { latitude: loc.lat(), longitude: loc.lng() };
            map.setCenter(loc);
            map.setZoom(15);
            marker.setPosition(loc);
            onPickRef.current(coords, place.formatted_address ?? null);
          });
        }
        setReady(true);
        markMapsHealthy();
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
    // Init runs once on mount; further lat/lng changes are handled by the
    // recenter effect below instead of re-creating the map.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A saved value loading in (or a search/geolocation elsewhere updating the
  // parent's state) needs to move the already-created map/marker imperatively.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || latitude === null || longitude === null) return;
    const position = { lat: latitude, lng: longitude };
    markerRef.current.setPosition(position);
    mapRef.current.setCenter(position);
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 14, 14));
  }, [latitude, longitude]);

  // One press, one lookup (never as-you-type: the lookup goes through
  // Nominatim, which allows about a request a second).
  async function findOnMap() {
    const query = addressQuery.trim();
    if (!shopSlug || query.length < 5 || finding) return;
    setFinding(true);
    setFindError(null);
    setFound(null);
    try {
      const result = await geocodeAddress(shopSlug, query);
      onPickRef.current({ latitude: result.latitude, longitude: result.longitude }, null);
      setFound(result.displayName);
    } catch {
      setFindError("We could not find that address. Check it and try again.");
    } finally {
      setFinding(false);
    }
  }

  if (unavailable) {
    return (
      <div className={className}>
        <div
          role="status"
          data-testid="map-unavailable"
          className="w-full rounded-lg border border-black/15 p-3 text-sm text-zinc-600 space-y-2"
        >
          <p>{MAPS_UNAVAILABLE_MESSAGE}</p>
          {shopSlug && (
            <div className="space-y-2">
              <button
                type="button"
                onClick={findOnMap}
                disabled={finding || addressQuery.trim().length < 5}
                className={`h-9 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50 ${BUTTON_OUTLINE_CLASS}`}
              >
                {finding ? "Searching…" : "Find on map"}
              </button>
              {found && (
                <p className="text-xs break-words" data-testid="map-found">
                  Location found: {found}
                </p>
              )}
              {findError && (
                <p className="text-xs" role="alert">
                  {findError}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <input
        ref={inputRef}
        placeholder="Search an address"
        className="w-full h-9 rounded-lg border border-black/15 bg-white px-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20 mb-2"
      />
      <div
        ref={mapDivRef}
        className={`w-full h-64 rounded-lg overflow-hidden border border-black/15 ${ready ? "" : "animate-pulse bg-zinc-100"}`}
      />
    </div>
  );
}
