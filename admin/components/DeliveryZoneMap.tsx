"use client";

import { useEffect, useRef, useState } from "react";
import { loadGoogleMaps } from "@/lib/google-maps-loader";

// Roughly the geographic center of the UAE, zoomed out enough to show the
// whole country — the "New zone" modal's default view before a merchant has
// picked a real location for this zone.
export const UAE_CENTER = { lat: 23.85, lng: 54.4 };

export default function DeliveryZoneMap({
  center,
  radiusKm,
  onChange,
}: {
  center: { lat: number; lng: number };
  radiusKm: number;
  onChange: (coords: { lat: number; lng: number }) => void;
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const markerRef = useRef<google.maps.Marker | null>(null);
  const circleRef = useRef<google.maps.Circle | null>(null);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
  });

  // Init map/marker/circle once. Further center/radius changes (from the
  // radius slider, or a saved zone's coords loading in) are applied
  // imperatively by the effects below instead of re-creating the map.
  useEffect(() => {
    let cancelled = false;
    loadGoogleMaps(() => {
      if (!cancelled) setFailed(true);
    }).then((g) => {
      if (cancelled || !mapDivRef.current) return;
      const isDefault = center.lat === UAE_CENTER.lat && center.lng === UAE_CENTER.lng;
      const map = new g.maps.Map(mapDivRef.current, {
        center,
        zoom: isDefault ? 7 : 12,
        streetViewControl: false,
        mapTypeControl: false,
        fullscreenControl: false,
      });
      const marker = new g.maps.Marker({ position: center, map, draggable: true });
      const circle = new g.maps.Circle({
        center,
        radius: radiusKm * 1000,
        map,
        strokeColor: "#069494",
        strokeOpacity: 0.8,
        strokeWeight: 2,
        fillColor: "#069494",
        fillOpacity: 0.15,
      });
      marker.addListener("drag", () => {
        const pos = marker.getPosition();
        if (!pos) return;
        circle.setCenter(pos);
      });
      marker.addListener("dragend", () => {
        const pos = marker.getPosition();
        if (!pos) return;
        onChangeRef.current({ lat: pos.lat(), lng: pos.lng() });
      });
      map.addListener("click", (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        marker.setPosition(e.latLng);
        circle.setCenter(e.latLng);
        onChangeRef.current({ lat: e.latLng.lat(), lng: e.latLng.lng() });
      });
      mapRef.current = map;
      markerRef.current = marker;
      circleRef.current = circle;
      setReady(true);
    }).catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!markerRef.current || !circleRef.current || !mapRef.current) return;
    markerRef.current.setPosition(center);
    circleRef.current.setCenter(center);
    mapRef.current.setCenter(center);
  }, [center]);

  useEffect(() => {
    circleRef.current?.setRadius(radiusKm * 1000);
  }, [radiusKm]);

  return (
    <div>
      {failed ? (
        <div className="w-full h-64 rounded-lg border border-border dark:border-white/15 flex items-center justify-center text-sm text-text-faint text-center px-6">
          Map unavailable. You can still set the radius above; try again shortly for the map preview.
        </div>
      ) : (
        <div
          ref={mapDivRef}
          className={`w-full h-64 rounded-lg overflow-hidden border border-border dark:border-white/15 ${ready ? "" : "animate-pulse bg-zinc-100 dark:bg-zinc-800"}`}
        />
      )}
      <p className="text-xs text-text-faint mt-1.5">Click the map or drag the pin to set the delivery area center.</p>
    </div>
  );
}
