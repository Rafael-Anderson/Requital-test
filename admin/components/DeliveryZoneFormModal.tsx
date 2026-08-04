"use client";

import { useState, type FormEvent } from "react";
import { createDeliveryZone, updateDeliveryZone } from "@/lib/api";
import type { DeliveryZone } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Toggle from "@/components/ui/Toggle";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

export default function DeliveryZoneFormModal({
  outletId,
  zone,
  onClose,
  onSaved,
}: {
  outletId: number;
  zone: DeliveryZone | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(zone?.name ?? "");
  const [fee, setFee] = useState(zone?.fee ?? "0");
  const [minOrderAmount, setMinOrderAmount] = useState(zone?.minOrderAmount ?? "0");
  const [isActive, setIsActive] = useState(zone?.isActive ?? true);
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
    <Modal onClose={onClose} size="sm" title={zone ? `Edit "${zone.name}"` : "New zone"}>
      {(requestClose) => (
      <form onSubmit={handleSubmit}>
        <div className="space-y-3.5">
          <Input
            label="Name"
            placeholder="e.g. Dubai, DXB/SHJ/AJM, Other Emirate"
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
          <div className="flex items-center gap-2">
            <Toggle checked={isActive} onChange={setIsActive} />
            <span className="text-sm">Active</span>
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-white dark:bg-zinc-900">
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
