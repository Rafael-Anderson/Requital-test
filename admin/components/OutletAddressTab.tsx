"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { updateOutlet } from "@/lib/api";
import type { Outlet } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Card from "@/components/ui/Card";
import { useToast } from "@/components/ui/Toast";
import MapPicker from "@/components/MapPicker";

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
  const [saving, setSaving] = useState(false);
  const toast = useToast();

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
    <div className="space-y-4">
      <Card>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <Input label="Emirate" value={emirate} onChange={(e) => setEmirate(e.target.value)} />
          <Input label="Area" value={area} onChange={(e) => setArea(e.target.value)} />
        </div>
      </Card>

      <Card>
        <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">Coordinates</p>
        <MapPicker
          className="mb-3"
          latitude={latitude ? Number(latitude) : null}
          longitude={longitude ? Number(longitude) : null}
          onPick={(coords) => {
            setLatitude(String(coords.latitude));
            setLongitude(String(coords.longitude));
          }}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
        <p className="text-xs text-text-faint mt-1.5">Drag the pin or search above, or enter coordinates manually.</p>
      </Card>

      <Button variant="primary" onClick={handleSave} disabled={saving}>
        <Check className="size-4 inline -mt-0.5 mr-1" />
        Save changes
      </Button>
    </div>
  );
}
