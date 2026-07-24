"use client";

import { useState } from "react";
import { Check, MapPin } from "lucide-react";
import { geocodeAddress, updateOutlet } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

export default function OutletAddressTab({
  outlet,
  onSaved,
}: {
  outlet: Outlet;
  onSaved: () => void;
}) {
  const [emirate, setEmirate] = useState(outlet.emirate ?? "");
  const [area, setArea] = useState(outlet.area ?? "");
  const [latitude, setLatitude] = useState(outlet.latitude !== null ? String(outlet.latitude) : "");
  const [longitude, setLongitude] = useState(outlet.longitude !== null ? String(outlet.longitude) : "");
  const [geocodeQuery, setGeocodeQuery] = useState("");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleFindCoordinates() {
    const query = geocodeQuery.trim() || [outlet.name, area, emirate, "UAE"].filter(Boolean).join(", ");
    if (!query.trim()) {
      toast("Enter an address to search", "error");
      return;
    }
    setGeocoding(true);
    try {
      const result = await geocodeAddress(query);
      if (!result) {
        toast("No location found for that search", "error");
        return;
      }
      setLatitude(String(result.latitude));
      setLongitude(String(result.longitude));
      toast(`Found: ${result.displayName}`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Geocoding lookup failed", "error");
    } finally {
      setGeocoding(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      await updateOutlet(outlet.id, {
        emirate: emirate || undefined,
        area: area || undefined,
        latitude: latitude ? Number(latitude) : undefined,
        longitude: longitude ? Number(longitude) : undefined,
      });
      toast("Address saved");
      onSaved();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save address", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <Input label="Emirate" value={emirate} onChange={(e) => setEmirate(e.target.value)} />
      <Input label="Area" value={area} onChange={(e) => setArea(e.target.value)} />

      <div>
        <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-2">Coordinates</p>
        <div className="flex gap-2 mb-2">
          <input
            value={geocodeQuery}
            onChange={(e) => setGeocodeQuery(e.target.value)}
            placeholder="Search an address (optional — falls back to name/area/emirate)"
            className="flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-black/40 dark:focus:border-white/40 focus:ring-[3px] focus:ring-black/10 dark:focus:ring-white/15"
          />
          <Button type="button" variant="secondary" onClick={handleFindCoordinates} disabled={geocoding}>
            <MapPin className="size-4 inline -mt-0.5 mr-1" />
            Find
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Latitude"
            type="number"
            step="0.000001"
            value={latitude}
            onChange={(e) => setLatitude(e.target.value)}
          />
          <Input
            label="Longitude"
            type="number"
            step="0.000001"
            value={longitude}
            onChange={(e) => setLongitude(e.target.value)}
          />
        </div>
        <p className="text-xs text-zinc-400 mt-1.5">
          Powered by OpenStreetMap — or enter coordinates manually.
        </p>
      </div>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
    </div>
  );
}
