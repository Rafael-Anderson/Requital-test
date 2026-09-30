"use client";

import { useState, type FormEvent } from "react";
import { createDeliveryZone, updateDeliveryZone } from "@/lib/api";
import type { DeliveryZone, Region } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import MultiCombobox from "@/components/ui/MultiCombobox";
import { useToast } from "@/components/ui/Toast";
import DeliveryZoneMap, { UAE_CENTER } from "@/components/DeliveryZoneMap";

export default function DeliveryZoneFormModal({
  outletId,
  zone,
  regions,
  regionLabel,
  onClose,
  onSaved,
}: {
  outletId: number;
  zone: DeliveryZone | null;
  regions: Region[];
  regionLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [fee, setFee] = useState(zone?.fee ?? "0");
  const [minOrderAmount, setMinOrderAmount] = useState(zone?.minOrderAmount ?? "0");
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
  const [center, setCenter] = useState(
    zone?.lat !== null && zone?.lat !== undefined && zone?.lng !== null && zone?.lng !== undefined
      ? { lat: Number(zone.lat), lng: Number(zone.lng) }
      : UAE_CENTER,
  );
  const [radiusKm, setRadiusKm] = useState(zone?.radiusKm !== null && zone?.radiusKm !== undefined ? Number(zone.radiusKm) : 5);
  // Only sent once the merchant has touched the picker: saving a fee change on an
  // old zone must not try to overwrite (or demand) its regions.
  const [regionIds, setRegionIds] = useState<string[]>((zone?.regions ?? []).map((r) => String(r.id)));
  const [regionsTouched, setRegionsTouched] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const payload = {
        name,
        fee: Number(fee) || 0,
        minOrderAmount: Number(minOrderAmount) || 0,
        isActive,
        lat: center.lat,
        lng: center.lng,
        radiusKm,
        ...(regionsTouched && { regionIds: regionIds.map(Number) }),
      };
      if (zone) {
        await updateDeliveryZone(outletId, zone.id, payload);
        toast(`"${name}" updated`);
      } else {
        await createDeliveryZone(outletId, payload);
        toast(`"${name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save zone", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={zone ? `Edit "${zone.name}"` : "New zone"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          <Input
            label="Name"
            placeholder="e.g. Central Dubai"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
          />
          <Input
            label="Delivery Fee"
            type="number"
            min="0"
            step="0.01"
            value={fee}
            onChange={(e) => setFee(e.target.value)}
          />
          <Input
            label="Minimum Order Amount"
            type="number"
            min="0"
            step="0.01"
            value={minOrderAmount}
            onChange={(e) => setMinOrderAmount(e.target.value)}
          />
          {regions.length > 0 && (
            <MultiCombobox
              label={`${regionLabel}s covered`}
              value={regionIds}
              onChange={(next) => {
                setRegionIds(next);
                setRegionsTouched(true);
              }}
              options={regions.map((r) => ({ value: String(r.id), label: r.nameEn }))}
              placeholder={`Select ${regionLabel.toLowerCase()}s`}
              searchPlaceholder={`Search ${regionLabel.toLowerCase()}s`}
            />
          )}
          <div className="flex items-center gap-2">
            <Toggle checked={isActive} onChange={setIsActive} />
            <span className="text-sm">Active</span>
          </div>
          <div>
            <p className="text-sm font-medium text-text-secondary dark:text-zinc-400 mb-2">
              Delivery area (optional)
            </p>
            <DeliveryZoneMap
              center={center}
              radiusKm={radiusKm}
              onChange={setCenter}
            />
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <label htmlFor="zone-radius" className="text-sm font-medium">
                  Radius
                </label>
                <span className="text-sm text-text-faint">{radiusKm} km</span>
              </div>
              <input
                id="zone-radius"
                type="range"
                min={1}
                max={100}
                step={1}
                value={radiusKm}
                onChange={(e) => setRadiusKm(Number(e.target.value))}
                className="w-full accent-accent"
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
          <Button type="button" variant="secondary" onClick={requestClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={saving} loading={saving}>
            {zone ? "Save changes" : "Create zone"}
          </Button>
        </div>
      </form>
      )}
    </Modal>
  );
}
