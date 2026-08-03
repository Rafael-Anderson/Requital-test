"use client";

import { useState } from "react";
import { Plus, X } from "lucide-react";
import type { Ingredient, IngredientCategory } from "@/lib/types";
import Button from "@/components/ui/Button";

export interface RecipeRowDraft {
  ingredientId: number;
  quantityPerUnit: string;
}

// Shared editor for a Bill of Materials recipe row list — used both for a
// product's default recipe (ProductForm) and a single variant's override
// recipe (VariantEditModal). Purely a controlled list editor (rows/onChange)
// with no save button of its own — the caller submits `rows` alongside the
// rest of its own form, same as every other "replaces the full set on save"
// list on this form (categories, tags, images).
export default function IngredientRecipeEditor({
  ingredients,
  categories,
  rows,
  onChange,
}: {
  ingredients: Ingredient[];
  categories: IngredientCategory[];
  rows: RecipeRowDraft[];
  onChange: (rows: RecipeRowDraft[]) => void;
}) {
  // Filters which ingredients are offered in the row dropdowns/"Add
  // ingredient" below — a picker convenience for shops with a large
  // ingredient list, not a constraint on what's already in `rows` (an
  // existing row keeps its ingredient selected even if its category is
  // filtered out, same as any filter-doesn't-hide-existing-selections UX).
  const [categoryFilter, setCategoryFilter] = useState("");
  const filteredIngredients =
    categoryFilter === "" ? ingredients : ingredients.filter((i) => i.categoryId === Number(categoryFilter));

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
      {categories.length > 0 && (
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          aria-label="Filter ingredients by category"
          className="h-8 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2.5 text-xs outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      )}
      {rows.map((row, index) => {
        // A row's already-selected ingredient always stays in its own
        // dropdown even if the category filter would otherwise exclude it —
        // the filter narrows what's offered when picking, it never hides an
        // existing selection out from under the row.
        const selected = ingredients.find((i) => i.id === row.ingredientId);
        const options =
          selected && !filteredIngredients.some((i) => i.id === selected.id)
            ? [selected, ...filteredIngredients]
            : filteredIngredients;
        return (
        <div key={index} className="flex items-center gap-2">
          <select
            value={row.ingredientId}
            onChange={(e) => updateRow(index, { ingredientId: Number(e.target.value) })}
            className="flex-1 h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          >
            {options.map((ing) => (
              <option key={ing.id} value={ing.id}>
                {ing.name}
              </option>
            ))}
          </select>
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
