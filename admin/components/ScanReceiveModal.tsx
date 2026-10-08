"use client";

import { useRef, useState, type FormEvent } from "react";
import { Minus } from "lucide-react";
import { receivePurchaseOrder, scanPurchaseOrderLine } from "@/lib/api";
import type { PurchaseOrderDetail } from "@/lib/types";
import { addToTally, removeFromTally, tallyEntries, tallyTotal, type Tally } from "@/lib/scan-tally";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Modal from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";

function newKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `s-${Date.now()}-${Math.round(Math.random() * 1e9)}`;
}

// Scan-driven receive. Each scan (a hardware scanner types the code and presses Enter)
// is resolved by the server to one open line and checked against the tally; nothing is
// posted until "Receive scanned items", which goes through the SAME receive endpoint as
// the manual modal. The idempotency key is per tally: a retry of an unchanged tally
// reuses it (never posts twice), and any change to the tally takes a new one.
export default function ScanReceiveModal({
  po,
  onClose,
  onReceived,
}: {
  po: PurchaseOrderDetail;
  onClose: () => void;
  onReceived: () => void;
}) {
  const toast = useToast();
  const [code, setCode] = useState("");
  const [tally, setTally] = useState<Tally>({});
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const keyRef = useRef(newKey());
  const inputRef = useRef<HTMLInputElement>(null);

  function changeTally(next: Tally) {
    keyRef.current = newKey();
    setTally(next);
  }

  async function handleScan(e: FormEvent) {
    e.preventDefault();
    const value = code.trim();
    if (!value || scanning) return;
    setScanning(true);
    setError(null);
    try {
      const res = await scanPurchaseOrderLine(po.id, { code: value, pending: tallyEntries(tally) });
      changeTally(addToTally(tally, res.line.id, res.quantity));
      setCode("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Scan failed");
      setCode("");
    } finally {
      setScanning(false);
      inputRef.current?.focus();
    }
  }

  async function handleCommit() {
    setSaving(true);
    setError(null);
    try {
      await receivePurchaseOrder(po.id, { lines: tallyEntries(tally), idempotencyKey: keyRef.current });
      toast("Scanned items received into stock");
      onReceived();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to receive");
    } finally {
      setSaving(false);
    }
  }

  const entries = tallyEntries(tally);
  return (
    <Modal onClose={onClose} size="md" title={`Scan to receive ${po.poNumber}`}>
      {(requestClose) => (
        <div>
          <form onSubmit={handleScan} className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <Input
                ref={inputRef}
                autoFocus
                label="Barcode or SKU"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                autoComplete="off"
                inputMode="text"
              />
            </div>
            <Button type="submit" variant="secondary" disabled={scanning || code.trim() === ""} loading={scanning}>
              Add
            </Button>
          </form>
          {error && (
            <p role="alert" className="mt-3 text-sm text-red-600">
              {error}
            </p>
          )}
          <ul className="mt-4 space-y-2">
            {entries.length === 0 && <li className="text-sm text-text-muted">Scan an item to start the delivery tally.</li>}
            {entries.map((e) => {
              const line = po.lines.find((l) => l.id === e.lineId);
              return (
                <li key={e.lineId} className="flex items-center justify-between gap-3 rounded-xl border border-border p-3 text-sm dark:border-white/10">
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-text-primary dark:text-zinc-100">{line?.description ?? "Item"}</div>
                    <div className="text-xs text-text-muted">
                      {line ? `${line.quantityReceived + e.quantity} of ${line.quantityOrdered} after this delivery` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold">{e.quantity}</span>
                    <button
                      type="button"
                      aria-label={`Remove one ${line?.description ?? "item"}`}
                      className="rounded p-1.5 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
                      onClick={() => changeTally(removeFromTally(tally, e.lineId))}
                    >
                      <Minus className="size-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="sticky bottom-0 mt-5 flex justify-end gap-2 bg-surface pb-6 dark:bg-zinc-900">
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="button" variant="primary" disabled={saving || entries.length === 0} loading={saving} onClick={handleCommit}>
              {saving ? "Receiving…" : `Receive ${tallyTotal(tally)} scanned`}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
