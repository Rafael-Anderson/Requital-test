"use client";

import { useState } from "react";
import { createTaxClass, updateTaxClass } from "@/lib/api";
import {
  TAX_CLASS_TYPES,
  TAX_CLASS_TYPE_LABELS,
  type TaxClass,
  type TaxClassType,
} from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import { useToast } from "@/components/ui/Toast";

// Only a standard-rate class can carry a rate. The backend rejects anything
// else (a "zero rated" class at 5% would charge VAT on goods the merchant has
// declared zero-rated), so the form mirrors that rule rather than letting the
// merchant type a value the save will refuse.
function ratedType(type: TaxClassType) {
  return type === "standard";
}

export default function TaxClassFormModal({
  taxClass,
  onClose,
  onSaved,
}: {
  taxClass: TaxClass | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(taxClass?.name ?? "");
  const [type, setType] = useState<TaxClassType>(taxClass?.type ?? "standard");
  const [rate, setRate] = useState(taxClass ? taxClass.rate : "0");
  const [isDefault, setIsDefault] = useState(taxClass?.isDefault ?? false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const effectiveRate = ratedType(type) ? Number(rate) || 0 : 0;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      if (taxClass) {
        await updateTaxClass(taxClass.id, {
          name,
          type,
          rate: effectiveRate,
          // Only ever sent as true: the backend refuses to clear the flag,
          // because a shop with no default has nothing to fall back to.
          ...(isDefault && !taxClass.isDefault && { isDefault: true }),
        });
        toast(`"${name}" updated`);
      } else {
        await createTaxClass({
          name,
          type,
          rate: effectiveRate,
          ...(isDefault && { isDefault: true }),
        });
        toast(`"${name}" created`);
      }
      onSaved();
      onClose();
    } catch (err) {
      toast(
        err instanceof Error ? err.message : "Failed to save tax class",
        "error",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      title={taxClass ? `Edit "${taxClass.name}"` : "New tax class"}
    >
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3.5">
            <Input
              label="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />

            <Select
              label="Treatment"
              value={type}
              onChange={(e) => setType(e.target.value as TaxClassType)}
              tooltip="Zero rated and exempt are both 0%, but they are reported differently on a VAT return."
            >
              {TAX_CLASS_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TAX_CLASS_TYPE_LABELS[t]}
                </option>
              ))}
            </Select>

            {ratedType(type) ? (
              <Input
                label="Rate (%)"
                type="number"
                min="0"
                max="100"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
              />
            ) : (
              <p className="text-[13px] text-text-muted">
                {TAX_CLASS_TYPE_LABELS[type]} classes are always 0%, so there is
                no rate to set.
              </p>
            )}

            <div>
              <div className="flex items-center gap-2.5">
                <Toggle
                  checked={isDefault}
                  disabled={taxClass?.isDefault}
                  onChange={setIsDefault}
                />
                <span className="text-[13px] font-medium text-text-secondary dark:text-zinc-400">
                  Default for new products
                </span>
              </div>
              {taxClass?.isDefault && (
                <p className="text-[13px] text-text-muted mt-1.5">
                  This is the default class. To move it, open another class and
                  make that one the default.
                </p>
              )}
            </div>
          </div>

          <div className="flex justify-end gap-2 mt-5 pb-6 sticky bottom-0 bg-surface dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={saving}
              loading={saving}
            >
              {taxClass ? "Save changes" : "Create tax class"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
