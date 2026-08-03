"use client";

import { useRef, useState, useEffect, type KeyboardEvent } from "react";
import { MapContainer, TileLayer, Marker, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./MapPickerLeaflet.css";
import { geocodeAddress, reverseGeocodeAddress } from "@/lib/api";
import type { MapPickerProps } from "./MapPicker";

// CARTO Voyager instead of the standard OSM raster tiles — OSM's default
// tiles label everything in the browser/OS locale (Arabic throughout this
// app's UAE customer base), Voyager always renders Latin/English labels
// regardless of locale. Tile data is still OSM's underneath, so both OSM
// and CARTO must be credited — this is CARTO's exact required attribution
// string (basemaps docs), not just an OSM copyright notice.
const TILE_URL = "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png";
const TILE_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

// Leaflet's default marker icon resolves its image URLs relative to its own
// module location, which breaks under Next.js's bundler (the well-known
// Leaflet+webpack/Turbopack issue — see the marker never appearing, or a
// broken-image icon, in prod builds). Fixed by deleting the private
// URL-guessing method and pointing the default icon at real static files
// copied into public/leaflet/ — not a CDN, so it works offline and
// identically in dev and prod builds. Runs once at module load, client-side
// only (this file is dynamic-imported with ssr:false from MapPicker.tsx).
// @ts-expect-error -- _getIconUrl is undocumented/private; Leaflet's own
// GitHub issue thread on this bug recommends deleting it this way.
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: "/leaflet/marker-icon-2x.png",
  iconUrl: "/leaflet/marker-icon.png",
  shadowUrl: "/leaflet/marker-shadow.png",
});

// Dubai — only used as the initial map center when no coordinates exist yet
// (a brand-new outlet); never sent anywhere as a real value.
const DEFAULT_CENTER: [number, number] = [25.2048, 55.2708];

// <MapContainer center> only sets the *initial* view (react-leaflet docs) —
// it doesn't track further prop changes, so a search result or saved-value
// load needs this imperative escape hatch to actually move the map.
function Recenter({ position }: { position: [number, number] }) {
  const map = useMap();
  useEffect(() => {
    map.setView(position, Math.max(map.getZoom(), 14));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position[0], position[1]]);
  return null;
}

export default function MapPickerLeaflet({ latitude, longitude, onPick, className = "" }: MapPickerProps) {
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const markerRef = useRef<L.Marker>(null);
  const position: [number, number] =
    latitude !== null && longitude !== null ? [latitude, longitude] : DEFAULT_CENTER;

  async function handleSearch() {
    if (!query.trim()) return;
    setSearching(true);
    try {
      const result = await geocodeAddress(query);
      if (result) onPick({ latitude: result.latitude, longitude: result.longitude }, result.displayName);
    } finally {
      setSearching(false);
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    // Not a <form onSubmit> — this component is rendered inside the
    // outlet/checkout/address <form> at every call site, and HTML doesn't
    // allow nested <form> elements (Next.js flags it as a hydration error,
    // and a nested form's Enter-to-submit silently routes to the wrong
    // form). Enter-to-search is reproduced by hand instead.
    if (e.key === "Enter") {
      e.preventDefault();
      handleSearch();
    }
  }

  return (
    <div className={className}>
      <div className="flex gap-2 mb-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search an address"
          className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        />
        <button
          type="button"
          onClick={handleSearch}
          disabled={searching}
          className="shrink-0 h-9 px-3 rounded-lg text-sm cursor-pointer disabled:opacity-50 border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 text-zinc-700 dark:text-zinc-200"
        >
          {searching ? "Searching…" : "Search"}
        </button>
      </div>
      <MapContainer
        center={position}
        zoom={latitude !== null ? 15 : 11}
        scrollWheelZoom
        className="w-full h-64 rounded-lg overflow-hidden border border-black/15 dark:border-white/15"
      >
        <TileLayer attribution={TILE_ATTRIBUTION} url={TILE_URL} />
        <Marker
          position={position}
          draggable
          ref={markerRef}
          eventHandlers={{
            dragend: () => {
              const marker = markerRef.current;
              if (!marker) return;
              const { lat, lng } = marker.getLatLng();
              const coords = { latitude: lat, longitude: lng };
              // Update coordinates immediately (no snap-back while the
              // reverse-geocode round trip is in flight), then patch the
              // address text in once it resolves.
              onPick(coords, null);
              reverseGeocodeAddress(lat, lng)
                .then((address) => {
                  if (address) onPick(coords, address);
                })
                .catch(() => {});
            },
          }}
        />
        <Recenter position={position} />
      </MapContainer>
    </div>
  );
}
