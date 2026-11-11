"use client";

import { useState, type FormEvent } from "react";
import { replacePurchaseOrderLines } from "@/lib/api";
import type { PurchaseOrderDetail } from "@/lib/types";
import { draftFromLine, toLineInputs, type LineDraft } from "@/lib/purchase-order-lines";
import Button from "@/components/ui/Button";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import PurchaseOrderLinesEditor, { usePurchasePickerOptions } from "@/components/PurchaseOrderLinesEditor";

// Draft only: the server refuses a line edit once the order is sent.
export default function EditPurchaseOrderLinesModal({
  po,
  onClose,
  onSaved,
}: {
  po: PurchaseOrderDetail;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const options = usePurchasePickerOptions();
  const [lines, setLines] = useState<LineDraft[]>(() => po.lines.map(draftFromLine));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = toLineInputs(lines);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await replacePurchaseOrderLines(po.id, parsed.lines);
      toast("Lines updated");
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save lines");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="lg" title={`Edit lines on ${po.poNumber}`}
      footer={(requestClose) => (
        <>
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" form="edit-purchase-order-lines-modal-form" variant="primary" disabled={saving} loading={saving}>
              {saving ? "Saving…" : "Save lines"}
            </Button>
          </>
      )}>
      {(requestClose) => (
        <form id="edit-purchase-order-lines-modal-form" onSubmit={handleSubmit}>
          <PurchaseOrderLinesEditor value={lines} onChange={setLines} currency={po.currency} options={options} />
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        </form>
      )}
    </Modal>
  );
}
