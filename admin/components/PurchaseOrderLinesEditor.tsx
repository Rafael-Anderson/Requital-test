"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { listIngredients, listProducts } from "@/lib/api";
import { formatMoney } from "@/lib/money";
import { newDraft, type LineDraft } from "@/lib/purchase-order-lines";
import Button from "@/components/ui/Button";
import Combobox, { type ComboboxOption } from "@/components/ui/Combobox";
import Input from "@/components/ui/Input";
import Tooltip from "@/components/ui/Tooltip";

// Everything a line can point at: ingredients, plus plain (non-recipe) products
// and their variants, which the server resolves to their own stock ingredient.
export function usePurchasePickerOptions(): ComboboxOption[] {
  // Ingredients and products load on independent requests, so a failure of one
  // still leaves the other's options pickable.
  const [ingredientOptions, setIngredientOptions] = useState<ComboboxOption[]>([]);
  const [productOptions, setProductOptions] = useState<ComboboxOption[]>([]);
  useEffect(() => {
    let live = true;
    listIngredients()
      .then((ingredients) => {
        if (live) setIngredientOptions(ingredients.map((i) => ({ value: `i:${i.id}`, label: `${i.name} (${i.unit})` })));
      })
      .catch(() => {});
    listProducts()
      .then((products) => {
        if (!live) return;
        const rows: ComboboxOption[] = [];
        for (const p of products) {
          if (p.usesIngredients) continue;
          if (p.hasVariants) {
            for (const v of p.variants) rows.push({ value: `p:${p.id}:${v.id}`, label: `${p.name}, ${v.label ?? "variant"}` });
          } else {
            rows.push({ value: `p:${p.id}`, label: p.name });
          }
        }
        setProductOptions(rows);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return useMemo(() => [...ingredientOptions, ...productOptions], [ingredientOptions, productOptions]);
}

function lineAmount(d: LineDraft): number | null {
  const q = Number(d.quantity);
  const c = Number(d.unitCost);
  if (d.unitCost.trim() === "" || !Number.isFinite(q) || !Number.isFinite(c)) return null;
  return q * c;
}

// A display-only estimate: the server rounds and stores the real figures.
export default function PurchaseOrderLinesEditor({
  value,
  onChange,
  currency,
  options,
}: {
  value: LineDraft[];
  onChange: (next: LineDraft[]) => void;
  currency: string | null;
  options: ComboboxOption[];
}) {
  const known = useMemo(() => value.map(lineAmount), [value]);
  const allKnown = known.length > 0 && known.every((k) => k !== null);
  const estimate = allKnown ? (known as number[]).reduce((a, b) => a + b, 0) : null;

  function patch(key: string, change: Partial<LineDraft>) {
    onChange(value.map((d) => (d.key === key ? { ...d, ...change } : d)));
  }

  return (
    <div>
      <div className="space-y-3">
        {value.map((d, i) => (
          <div key={d.key} className="grid grid-cols-1 gap-3 rounded-xl border border-border p-3 dark:border-white/10 sm:grid-cols-12">
            <div className="sm:col-span-5">
              <Combobox
                label={`Item ${i + 1}`}
                value={d.target}
                onChange={(target) => patch(d.key, { target })}
                options={options}
                placeholder="Choose an item"
                searchPlaceholder="Search items"
              />
            </div>
            <div className="sm:col-span-2">
              <Input
                label="Quantity"
                type="number"
                min={1}
                step={1}
                value={d.quantity}
                onChange={(e) => patch(d.key, { quantity: e.target.value })}
              />
            </div>
            <div className="sm:col-span-3">
              <Input
                label={currency ? `Unit cost (${currency})` : "Unit cost"}
                type="number"
                min={0}
                step="any"
                value={d.unitCost}
                onChange={(e) => patch(d.key, { unitCost: e.target.value })}
              />
            </div>
            <div className="flex items-end justify-between gap-2 sm:col-span-2">
              <div className="pb-2 text-sm font-semibold text-text-primary dark:text-zinc-100">
                {known[i] !== null && currency ? formatMoney(known[i], currency) : ""}
              </div>
              <Tooltip label={`Remove line ${i + 1}`} align="end">
                <button
                  type="button"
                  onClick={() => onChange(value.filter((x) => x.key !== d.key))}
                  className="p-1.5 mb-1 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                  aria-label={`Remove line ${i + 1}`}
                >
                  <Trash2 className="size-4" />
                </button>
              </Tooltip>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="secondary" onClick={() => onChange([...value, newDraft()])}>
          <Plus className="-mt-0.5 me-1 inline size-4" />
          Add line
        </Button>
        {estimate !== null && currency && (
          <div className="text-sm text-text-secondary dark:text-zinc-300">
            Estimated total <span className="font-bold text-text-primary dark:text-zinc-50">{formatMoney(estimate, currency)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
