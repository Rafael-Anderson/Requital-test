"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { bulkUpdateProductPrice } from "@/lib/api";
import type { Product } from "@/lib/types";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import { useToast } from "@/components/ui/Toast";

const SELECT_CLASS =
  "flex h-9 w-full rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20";

type Field = "price" | "compareAtPrice";
type Mode = "percentage" | "fixed";

// Preview is computed entirely client-side from the products already loaded
// in the list this modal was opened from — no round trip needed just to
// show what would happen. The actual commit (Apply) still goes through the
// server, which recomputes from the DB's current price rather than trusting
// anything calculated here — this preview is a convenience, never the
// source of truth for what gets written.
function computePreview(product: Product, field: Field, mode: Mode, value: number): number | null {
  const current = field === "price" ? product.price : product.compareAtPrice;
  if (current === null || current === undefined) return null;
  const currentNum = Number(current);
  const next = mode === "percentage" ? currentNum * (1 + value / 100) : currentNum + value;
  return Math.round(next * 100) / 100;
}

export default function BulkPriceUpdateModal({
  products,
  onClose,
  onApplied,
}: {
  products: Product[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const toast = useToast();
  const [field, setField] = useState<Field>("price");
  const [mode, setMode] = useState<Mode>("percentage");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  const numericValue = Number(value);
  const hasValue = value.trim() !== "" && !Number.isNaN(numericValue);

  const preview = useMemo(
    () =>
      products.map((p) => ({
        product: p,
        current: field === "price" ? p.price : p.compareAtPrice,
        next: hasValue ? computePreview(p, field, mode, numericValue) : null,
      })),
    [products, field, mode, numericValue, hasValue],
  );

  async function handleApply() {
    if (!hasValue) {
      toast("Enter a value", "error");
      return;
    }
    setSaving(true);
    try {
      const { succeeded, results } = await bulkUpdateProductPrice({
        productIds: products.map((p) => p.id),
        field,
        mode,
        value: numericValue,
      });
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        toast(`Updated ${succeeded}, ${failed.length} skipped (no price set or would go below zero)`, "error");
      } else {
        toast(`Updated pricing for ${succeeded} product${succeeded === 1 ? "" : "s"}`);
      }
      onApplied();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update prices", "error");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto modal-scroll rounded-lg bg-white dark:bg-zinc-900 border dark:border-white/10 p-6 relative"
      >
        <button
          type="button"
          onClick={onClose}
          className="absolute top-4 right-4 text-zinc-400 hover:text-zinc-800 dark:hover:text-zinc-200 transition-colors cursor-pointer"
          aria-label="Close"
        >
          <X className="size-5" />
        </button>

        <h2 className="text-lg font-semibold mb-1">Bulk price update</h2>
        <p className="text-sm text-zinc-500 mb-4">{products.length} product(s) selected</p>

        <div className="grid grid-cols-2 gap-3 mb-4">
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Field</label>
            <select value={field} onChange={(e) => setField(e.target.value as Field)} className={SELECT_CLASS}>
              <option value="price">Price</option>
              <option value="compareAtPrice">Compare-at price</option>
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">Adjustment</label>
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)} className={SELECT_CLASS}>
              <option value="percentage">Percentage</option>
              <option value="fixed">Fixed amount (AED)</option>
            </select>
          </div>
        </div>

        <Input
          label={mode === "percentage" ? "Percentage (e.g. 10 or -15)" : "Amount in AED (e.g. 5 or -5)"}
          type="number"
          step="0.01"
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />

        <div className="mt-4 border rounded-lg dark:border-white/10 overflow-hidden">
          <div className="max-h-64 overflow-y-auto divide-y divide-black/5 dark:divide-white/10">
            {preview.map(({ product, current, next }) => (
              <div key={product.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <span className="truncate">{product.name}</span>
                <span className="shrink-0 text-zinc-500">
                  {current === null ? "—" : current}
                  {" → "}
                  {next === null ? (
                    <span className="text-amber-600 dark:text-amber-400">skipped</span>
                  ) : (
                    <span className={next < Number(current) ? "text-red-600 dark:text-red-400" : "text-green-600 dark:text-green-400"}>
                      {next}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 mt-5">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" variant="primary" onClick={handleApply} disabled={saving || !hasValue}>
            {saving ? "Applying…" : "Apply"}
          </Button>
        </div>
      </div>
    </div>
  );
}
