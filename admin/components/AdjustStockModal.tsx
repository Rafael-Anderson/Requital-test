"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { adjustStockWithReason, setLowStockThreshold } from "@/lib/api";
import { ADJUSTMENT_REASON_LABELS, ADJUSTMENT_REASONS, type AdjustmentReason, type Ingredient, type Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Textarea from "@/components/ui/Textarea";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

// Discriminated the same way TransferStockModal.tsx's TransferTarget is —
// one modal for both Products (which may have variants) and Ingredients
// (which never do).
export type AdjustTarget =
  | { kind: "product"; product: Product }
  | { kind: "ingredient"; ingredient: Ingredient };

// Replaces the inline qty-input/reason-dropdown/Apply-button/alert-threshold
// cluster that used to render directly inside the Stock table cell on the
// Products and Ingredients list pages once a branch was selected — that
// cramped four small controls into one narrow column and made every row
// with it roughly 3x taller than a plain row. This is the same modal
// pattern already used for Transfer (TransferStockModal), triggered the
// same way: one icon button per row, opened on demand, closed after commit.
//
// Adjustment and alert threshold stay two separate actions with their own
// buttons (not one combined submit) — they were two independent operations
// before (adjusting stock is immediate; the threshold auto-saved on blur),
// or a merchant might want to fix only the threshold, or only add stock,
// not both.
export default function AdjustStockModal({
  target,
  outletId,
  outletName,
  onClose,
  onAdjusted,
}: {
  target: AdjustTarget;
  outletId: number;
  outletName: string;
  onClose: () => void;
  onAdjusted: () => void;
}) {
  const toast = useToast();
  const name = target.kind === "product" ? target.product.name : target.ingredient.name;
  const currentThreshold =
    target.kind === "product" ? target.product.lowStockThreshold : target.ingredient.lowStockThreshold;

  const [variantId, setVariantId] = useState("");
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState<AdjustmentReason | "">("");
  const [note, setNote] = useState("");
  const [adjusting, setAdjusting] = useState(false);

  const [threshold, setThreshold] = useState(currentThreshold === null ? "" : String(currentThreshold));
  const [savingThreshold, setSavingThreshold] = useState(false);

  const idField =
    target.kind === "product"
      ? { productId: target.product.id, variantId: variantId ? Number(variantId) : undefined }
      : { ingredientId: target.ingredient.id };

  async function handleAdjust(e: React.FormEvent) {
    e.preventDefault();
    const value = Number(delta);
    if (!delta || Number.isNaN(value) || value === 0) {
      toast("Enter a non-zero quantity", "error");
      return;
    }
    if (!reason) {
      toast("Pick a reason for this adjustment", "error");
      return;
    }
    setAdjusting(true);
    try {
      await adjustStockWithReason({ ...idField, outletId, delta: value, reason, note: note || undefined });
      toast(`Stock ${value > 0 ? "increased" : "decreased"} by ${Math.abs(value)}`);
      setDelta("");
      setReason("");
      setNote("");
      onAdjusted();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to adjust stock", "error");
    } finally {
      setAdjusting(false);
    }
  }

  async function handleSaveThreshold() {
    const value = threshold === "" ? null : Number(threshold);
    if (value !== null && (Number.isNaN(value) || value < 0)) {
      toast("Alert threshold must be a positive number", "error");
      return;
    }
    setSavingThreshold(true);
    try {
      await setLowStockThreshold({ ...idField, outletId, lowStockThreshold: value });
      toast(value === null ? "Low stock alert turned off" : `Low stock alert set at ${value}`);
      onAdjusted();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to set low stock alert", "error");
    } finally {
      setSavingThreshold(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">Adjust stock</h2>
        <p className="text-sm text-zinc-500 mb-4">
          {name} · {outletName}
        </p>

        <form onSubmit={handleAdjust} className="space-y-3.5">
          {target.kind === "product" && target.product.hasVariants && (
            <div>
              <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Variant</label>
              <select value={variantId} onChange={(e) => setVariantId(e.target.value)} className={SELECT_CLASS} required>
                <option value="">Select a variant…</option>
                {target.product.variants.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.label}
                  </option>
                ))}
              </select>
            </div>
          )}

          <Input label="Quantity (± to add or remove)" type="number" placeholder="e.g. 10 or -5" value={delta} onChange={(e) => setDelta(e.target.value)} />

          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Reason</label>
            <select
              value={reason}
              onChange={(e) => setReason(e.target.value as AdjustmentReason)}
              className={SELECT_CLASS}
            >
              <option value="">Select a reason…</option>
              {ADJUSTMENT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {ADJUSTMENT_REASON_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <Textarea label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} rows={2} />

          <div className="flex justify-end">
            <Button type="submit" variant="primary" disabled={adjusting}>
              {adjusting ? "Applying…" : "Apply adjustment"}
            </Button>
          </div>
        </form>

        <div className="mt-5 pt-5 border-t border-black/10 dark:border-white/10">
          <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Low stock alert</label>
          <div className="flex items-center gap-2">
            <input
              type="number"
              min={0}
              placeholder="Off"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              className="flex h-9 w-28 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            />
            <Button type="button" variant="secondary" size="sm" onClick={handleSaveThreshold} disabled={savingThreshold}>
              {savingThreshold ? "Saving…" : "Save"}
            </Button>
          </div>
          <p className="mt-1.5 text-xs text-zinc-400">Flags this item as low stock once it drops to or below this number. Leave blank to turn off.</p>
        </div>

        <div className="flex justify-end mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
