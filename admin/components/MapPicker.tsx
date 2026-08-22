"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }, address: string | null) => void;
  className?: string;
}

// Dubai — only used as the initial map center when no coordinates exist yet
// (a brand-new outlet); never sent anywhere as a real value.
const DEFAULT_CENTER = { lat: 25.2048, lng: 55.2708 };

export default function MapPicker({ latitude, longitude, onPick, className = "" }: MapPickerProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const onPickRef = useRef(onPick);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onPickRef.current = onPick;
  });

  // Init map + marker + autocomplete once, client-side only.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(() => {
      if (!cancelled) setFailed(true);
    })
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

  // A saved value loading in (or a search elsewhere updating the parent's
  // state) needs to move the already-created map/marker imperatively.
  useEffect(() => {
    if (!mapRef.current || !markerRef.current || latitude === null || longitude === null) return;
    const position = { lat: latitude, lng: longitude };
    markerRef.current.setPosition(position);
    mapRef.current.setCenter(position);
    mapRef.current.setZoom(Math.max(mapRef.current.getZoom() ?? 14, 14));
  }, [latitude, longitude]);

  return (
    <div className={className}>
      <input
        ref={inputRef}
        placeholder="Search an address"
        className="flex h-9 w-full rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20 mb-2"
      />
      {failed ? (
        <div className="w-full h-64 rounded-lg border border-border dark:border-white/15 flex items-center justify-center text-sm text-text-faint text-center px-6">
          Map unavailable. Verify the address above, or try again shortly.
        </div>
      ) : (
        <div
          ref={mapDivRef}
          className={`w-full h-64 rounded-lg overflow-hidden border border-border dark:border-white/15 ${ready ? "" : "animate-pulse bg-zinc-100 dark:bg-zinc-800"}`}
        />
      )}
    </div>
  );
}
