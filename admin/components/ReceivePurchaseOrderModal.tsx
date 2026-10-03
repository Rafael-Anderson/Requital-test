"use client";

import { useState, type FormEvent } from "react";
import { receivePurchaseOrder } from "@/lib/api";
import type { PurchaseOrderDetail } from "@/lib/types";
import { initialReceiveDrafts, outstanding, toReceiveInput, type ReceiveDraft } from "@/lib/receive-lines";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `r-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// Books a delivery into the PO's outlet. One idempotency key per open modal, so a
// double click or a retried request can never post the same delivery twice.
export default function ReceivePurchaseOrderModal({
  po,
  onClose,
  onReceived,
}: {
  po: PurchaseOrderDetail;
  onClose: () => void;
  onReceived: () => void;
}) {
  const toast = useToast();
  const [drafts, setDrafts] = useState<ReceiveDraft[]>(() => initialReceiveDrafts(po.lines));
  const [deliveryNoteRef, setDeliveryNoteRef] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idempotencyKey] = useState(newKey);

  function patch(lineId: number, change: Partial<ReceiveDraft>) {
    setDrafts((prev) => prev.map((d) => (d.lineId === lineId ? { ...d, ...change } : d)));
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const parsed = toReceiveInput(drafts, po.lines);
    if ("error" in parsed) {
      setError(parsed.error);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await receivePurchaseOrder(po.id, {
        ...parsed.input,
        ...(deliveryNoteRef.trim() ? { deliveryNoteRef: deliveryNoteRef.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
        idempotencyKey,
      });
      toast("Delivery received into stock");
      onReceived();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal onClose={onClose} size="md" title={`Receive ${po.poNumber}`}>
      {(requestClose) => (
        <form onSubmit={handleSubmit}>
          <div className="space-y-3">
            {drafts.map((d) => {
              const line = po.lines.find((l) => l.id === d.lineId)!;
              return (
                <div key={d.lineId} className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 dark:border-white/10 sm:grid-cols-12">
                  <div className="sm:col-span-6">
                    <div className="text-sm font-semibold text-text-primary dark:text-zinc-100">{line.description}</div>
                    <div className="text-xs text-text-muted">
                      {outstanding(line)} outstanding of {line.quantityOrdered}
                    </div>
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      label="Received"
                      type="number"
                      min={0}
                      max={outstanding(line)}
                      step={1}
                      value={d.quantity}
                      onChange={(e) => patch(d.lineId, { quantity: e.target.value })}
                    />
                  </div>
                  <div className="sm:col-span-3">
                    <Input
                      label={`Cost (${po.currency})`}
                      type="number"
                      min={0}
                      step="any"
                      value={d.unitCost}
                      onChange={(e) => patch(d.lineId, { unitCost: e.target.value })}
                    />
                  </div>
                </div>
              );
            })}
            {drafts.length === 0 && <p className="text-sm text-text-muted">Nothing is outstanding on this order.</p>}
            <Input label="Delivery note reference" value={deliveryNoteRef} onChange={(e) => setDeliveryNoteRef(e.target.value)} />
            <Input label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={saving || drafts.length === 0} loading={saving}>
              {saving ? "Receiving…" : "Receive into stock"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
