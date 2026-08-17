"use client";

import dynamic from "next/dynamic";

export interface MapPickerProps {
  latitude: number | null;
  longitude: number | null;
  onPick: (coords: { latitude: number; longitude: number }, address: string | null) => void;
  className?: string;
}

// Leaflet touches `window`/the DOM at module scope and MapContainer creates
// a real Leaflet map instance tied to a live DOM node, neither of which
// exist during Next's server render pass — ssr:false is the react-leaflet-
// recommended fix (not a workaround), see MapPickerLeaflet.tsx for the rest
// of the Leaflet+Next.js setup (marker icon assets, CSS import).
const MapPickerLeaflet = dynamic(() => import("./MapPickerLeaflet"), {
  ssr: false,
  loading: () => <div className="w-full h-64 rounded-lg border border-border dark:border-white/15 animate-pulse bg-zinc-100 dark:bg-zinc-800" />,
});

export default function MapPicker(props: MapPickerProps) {
  return <MapPickerLeaflet {...props} />;
}
