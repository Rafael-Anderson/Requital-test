"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Ingredient, IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";

export interface RecipeRowDraft {
  ingredientId: number;
  quantityPerUnit: string;
}

// Shared editor for a Bill of Materials recipe row list — used both for a
// product's default recipe (ProductForm) and a single variant's override
// recipe (VariantEditModal). Purely a controlled list editor (rows/onChange)
// with no save button of its own — the caller submits `rows` alongside the
// rest of its own form, same as every other "replaces the full set on save"
// list on this form (collections, tags, images).
export default function IngredientRecipeEditor({
  ingredients,
  collections,
  rows,
  onChange,
}: {
  ingredients: Ingredient[];
  collections: IngredientCategory[];
  rows: RecipeRowDraft[];
  onChange: (rows: RecipeRowDraft[]) => void;
}) {
  // Filters which ingredients are offered in the row dropdowns/"Add
  // ingredient" below — a picker convenience for shops with a large
  // ingredient list, not a constraint on what's already in `rows` (an
  // existing row keeps its ingredient selected even if its collection is
  // filtered out, same as any filter-doesn't-hide-existing-selections UX).
  const [collectionFilter, setCollectionFilter] = useState("");
  const filteredIngredients =
    collectionFilter === "" ? ingredients : ingredients.filter((i) => i.collectionId === Number(collectionFilter));

  function addRow() {
    const used = new Set(rows.map((r) => r.ingredientId));
    const next = filteredIngredients.find((i) => !used.has(i.id));
    if (!next) return;
    onChange([...rows, { ingredientId: next.id, quantityPerUnit: "1" }]);
  }

  function updateRow(index: number, patch: Partial<RecipeRowDraft>) {
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  }

  function removeRow(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  function unitFor(ingredientId: number) {
    return ingredients.find((i) => i.id === ingredientId)?.unit ?? "";
  }

  if (ingredients.length === 0) {
    return (
      <p className="text-xs text-zinc-400">
        No ingredients yet — add some in Inventory &gt; Ingredients first.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {collections.length > 0 && (
        <div className="w-48">
          <Combobox
            value={collectionFilter}
            onChange={setCollectionFilter}
            placeholder="All collections"
            options={[{ value: "", label: "All collections" }, ...collections.map((c) => ({ value: String(c.id), label: c.name }))]}
          />
        </div>
      )}
      {rows.map((row, index) => {
        // A row's already-selected ingredient always stays in its own
        // dropdown even if the collection filter would otherwise exclude it —
        // the filter narrows what's offered when picking, it never hides an
        // existing selection out from under the row.
        const selected = ingredients.find((i) => i.id === row.ingredientId);
        const options =
          selected && !filteredIngredients.some((i) => i.id === selected.id)
            ? [selected, ...filteredIngredients]
            : filteredIngredients;
        return (
        <div key={index} className="flex items-center gap-2">
          <div className="flex-1">
            <Combobox
              value={String(row.ingredientId)}
              onChange={(value) => updateRow(index, { ingredientId: Number(value) })}
              options={options.map((ing) => ({ value: String(ing.id), label: ing.name }))}
            />
          </div>
          <input
            type="number"
            min={1}
            step={1}
            value={row.quantityPerUnit}
            onChange={(e) => updateRow(index, { quantityPerUnit: e.target.value })}
            className="w-20 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2.5 text-sm outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
          <span className="text-xs text-zinc-400 w-14 shrink-0">{unitFor(row.ingredientId)}</span>
          <button
            type="button"
            onClick={() => removeRow(index)}
            aria-label="Remove ingredient"
            className="p-1.5 rounded text-zinc-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
          >
            <X className="size-4" />
          </button>
        </div>
        );
      })}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={addRow}
        disabled={rows.length >= filteredIngredients.length}
      >
        <Plus className="size-3.5 inline -mt-0.5 mr-1" />
        Add ingredient
      </Button>
    </div>
  );
}
