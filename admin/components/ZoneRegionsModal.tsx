"use client";

import { useState, type FormEvent } from "react";
import { setZoneMapping } from "@/lib/api";
import type { DeliveryZone, Region, ZoneMappingProposalItem } from "@/lib/types";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import MultiCombobox from "@/components/ui/MultiCombobox";
import { useToast } from "@/components/ui/Toast";

// The merchant's review of one delivery zone. Delivery zones used to be matched by
// comparing their free-text NAME with the customer's area, which silently missed a
// zone called "DXB/SHJ/AJM" or "Dubai Full". They are now matched by the regions a
// zone covers, but a shop only switches over once every active zone has been
// reviewed here, because the switch can change what customers are charged.
//
// The proposal is a suggestion, never applied for the merchant: it is pre-filled, and
// the merchant confirms. A proposal that is not exact says so.
export default function ZoneRegionsModal({
  outletId,
  zone,
  item,
  regions,
  regionLabel,
  onClose,
  onSaved,
}: {
  outletId: number;
  zone: DeliveryZone;
  item: ZoneMappingProposalItem;
  regions: Region[];
  regionLabel: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const initial = zone.regions && zone.regions.length > 0 ? zone.regions.map((r) => r.id) : item.proposal.regionIds;
  const [selected, setSelected] = useState<string[]>(initial.map(String));
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const label = regionLabel.toLowerCase();
  // With no regions the zone matches nothing, unless its map circle is placed, in
  // which case it matches by location alone.
  const canConfirm = selected.length > 0 || item.hasPlacedCircle;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    try {
      await setZoneMapping(outletId, zone.id, selected.map(Number));
      toast(`"${zone.name}" confirmed`);
      onSaved();
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Could not confirm this zone", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={`Review "${zone.name}"`}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-4">
            <div>
              <p className="text-sm font-medium mb-1">How it works today</p>
              <p className="text-sm text-text-muted">{item.current}</p>
            </div>

            <div
              className={`rounded-lg border px-3 py-2 text-sm ${
                item.proposal.confident
                  ? "border-green-200 dark:border-green-900 bg-green-50 dark:bg-green-950/40 text-green-800 dark:text-green-300"
                  : "border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300"
              }`}
            >
              <p className="font-medium">{item.proposal.confident ? "Suggested match" : "Please check this one"}</p>
              <p>{item.proposal.explanation}</p>
            </div>

            <MultiCombobox
              label={`${regionLabel}s this zone covers`}
              value={selected}
              onChange={setSelected}
              options={regions.map((r) => ({ value: String(r.id), label: r.nameEn }))}
              placeholder={`Select ${label}s`}
              searchPlaceholder={`Search ${label}s`}
            />
            {!canConfirm && (
              <p className="text-xs text-amber-700 dark:text-amber-400">
                Choose at least one {label}. Without one, and without a placed map circle, this zone would match no customer.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || !canConfirm} loading={saving}>
              Confirm {label}s
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
