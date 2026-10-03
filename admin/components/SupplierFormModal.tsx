"use client";

import { useState, type FormEvent } from "react";
import { createSupplier, updateSupplier } from "@/lib/api";
import { SUPPLIER_CURRENCIES, type Supplier } from "@/lib/types";
import { currencyDecimals } from "@/lib/money";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Select from "@/components/ui/Select";
import Textarea from "@/components/ui/Textarea";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

// Blank optional fields are sent as null, never a default: an unset currency
// means "unknown", and a minimum order amount needs one (the server enforces it
// too, this just says so before the round trip).
export default function SupplierFormModal({
  supplier,
  onClose,
  onSaved,
}: {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (id: number) => void;
}) {
  const toast = useToast();
  const [name, setName] = useState(supplier?.name ?? "");
  const [paymentTerms, setPaymentTerms] = useState(supplier?.paymentTerms ?? "");
  const [leadTimeDays, setLeadTimeDays] = useState(supplier?.leadTimeDays?.toString() ?? "");
  const [currency, setCurrency] = useState(supplier?.currency ?? "");
  const [minimum, setMinimum] = useState(supplier?.minimumOrderAmount ?? "");
  const [notes, setNotes] = useState(supplier?.notes ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    if (minimum.trim() !== "" && currency === "") {
      setError("Choose a currency to set a minimum order amount.");
      return;
    }
    setError(null);
    const data = {
      name: name.trim(),
      paymentTerms: paymentTerms.trim() || null,
      leadTimeDays: leadTimeDays.trim() === "" ? null : Number(leadTimeDays),
      currency: currency || null,
      minimumOrderAmount: minimum.trim() === "" ? null : Number(minimum),
      notes: notes.trim() || null,
    };
    setSaving(true);
    try {
      const saved = supplier ? await updateSupplier(supplier.id, data) : await createSupplier(data);
      toast(`"${data.name}" ${supplier ? "updated" : "added"}`);
      onSaved(saved.id);
      onClose();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to save supplier", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={supplier ? "Edit supplier" : "New supplier"}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </div>
            <Input
              label="Payment terms"
              value={paymentTerms}
              onChange={(e) => setPaymentTerms(e.target.value)}
              placeholder="Net 30"
            />
            <Input
              label="Lead time (days)"
              type="number"
              min={0}
              step={1}
              value={leadTimeDays}
              onChange={(e) => setLeadTimeDays(e.target.value)}
            />
            <Select label="Currency" value={currency} onChange={(e) => setCurrency(e.target.value)}>
              <option value="">Not set</option>
              {SUPPLIER_CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
            <Input
              label="Minimum order amount"
              type="number"
              min={0}
              step={currencyDecimals(currency) === 3 ? 0.001 : 0.01}
              value={minimum}
              onChange={(e) => setMinimum(e.target.value)}
            />
            <div className="sm:col-span-2">
              <Textarea label="Notes" value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
            </div>
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving} loading={saving}>
              {saving ? "Saving…" : supplier ? "Save changes" : "Add supplier"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
