"use client";

import type { StockByOutlet } from "@/lib/types";

// Shared by the top-level product Inventory section and the per-variant
// edit modal — same row shape (outletId/outletName/stockQuantity), just a
// different owner (product vs variant) deciding what to do with edited
// values on save. Values are absolute quantities, not deltas — the caller
// converts to a delta against `stockQuantity` before calling adjustStock.
export default function OutletQuantityTable({
  rows,
  values,
  onChangeValue,
}: {
  rows: StockByOutlet[];
  values: Record<number, string>;
  onChangeValue: (outletId: number, value: string) => void;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-zinc-400">No branches configured yet.</p>;
  }
  return (
    <div className="rounded-lg border border-black/10 dark:border-white/10 divide-y divide-black/5 dark:divide-white/10 overflow-hidden">
      {rows.map((row) => (
        <div key={row.outletId} className="flex items-center justify-between gap-3 px-3 py-2">
          <span className="text-sm">{row.outletName}</span>
          <input
            type="number"
            min={0}
            value={values[row.outletId] ?? String(row.stockQuantity)}
            onChange={(e) => onChangeValue(row.outletId, e.target.value)}
            className="w-24 border border-black/15 dark:border-white/15 rounded px-2 py-1 text-sm text-right dark:bg-zinc-900 outline-none focus:border-accent transition-colors"
          />
        </div>
      ))}
    </div>
  );
}
