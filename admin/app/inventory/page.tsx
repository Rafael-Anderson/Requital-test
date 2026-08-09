"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeftRight, ChevronDown, Pencil, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import {
  confirmImportIngredients,
  deleteIngredient,
  listIngredientCategories,
  listIngredients,
  previewImportIngredients,
} from "@/lib/api";
import type { Ingredient, IngredientCategory } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { downloadCsv } from "@/lib/csv";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import InventoryTabs from "@/components/InventoryTabs";
import PageShell from "@/components/ui/PageShell";
import IngredientFormModal from "@/components/IngredientFormModal";
import TransferStockModal from "@/components/TransferStockModal";
import AdjustStockModal from "@/components/AdjustStockModal";
import CsvImportModal from "@/components/CsvImportModal";
import DropdownMenu from "@/components/ui/DropdownMenu";

export default function IngredientsPage() {
  const [ingredients, setIngredients] = useState<Ingredient[] | null>(null);
  const [categories, setCategories] = useState<IngredientCategory[]>([]);
  const [categoryFilter, setCategoryFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Ingredient | null>(null);
  const [creating, setCreating] = useState(false);
  const [transferring, setTransferring] = useState<Ingredient | null>(null);
  const [adjusting, setAdjusting] = useState<Ingredient | null>(null);
  const [importing, setImporting] = useState(false);
  const [lowStockOnly, setLowStockOnly] = useState(false);
  const toast = useToast();
  const deleteWithUndo = useUndoableDelete();
  const { selectedOutletId, outlets } = useOutletFilter();

  const refresh = useCallback(async () => {
    try {
      setIngredients(await listIngredients(selectedOutletId ?? undefined, categoryFilter ? Number(categoryFilter) : undefined));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ingredients");
    }
  }, [selectedOutletId, categoryFilter]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    listIngredientCategories()
      .then(setCategories)
      .catch(() => setCategories([]));
  }, []);

  function handleDelete(ingredient: Ingredient) {
    deleteWithUndo({
      id: ingredient.id,
      label: `"${ingredient.name}"`,
      onRemoveLocally: () => setIngredients((prev) => (prev ? prev.filter((i) => i.id !== ingredient.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteIngredient(ingredient.id),
    });
  }

  // Column order matches INGREDIENT_IMPORT_HEADERS in backend/src/products/
  // products-import.ts — Import CSV reads this same shape back.
  function handleExport() {
    const rows = ingredients ?? [];
    downloadCsv(
      `ingredients-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Name", "Unit", "Track Inventory", "Stock"],
      rows.map((i) => [i.name, i.unit, i.trackInventory, i.stockQuantity ?? ""]),
    );
    toast(`Exported ${rows.length} ingredient${rows.length === 1 ? "" : "s"}`);
  }

  const visibleIngredients = (ingredients ?? []).filter(
    (i) =>
      !lowStockOnly ||
      (i.stockQuantity !== null && i.lowStockThreshold !== null && i.stockQuantity <= i.lowStockThreshold),
  );

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/" />} />
      <InventoryTabs />
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Ingredients</h1>
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            aria-label="Filter by category"
            className="h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-2.5 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          >
            <option value="">All categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-sm text-zinc-600 dark:text-zinc-400 cursor-pointer select-none">
            <Checkbox checked={lowStockOnly} onChange={(e) => setLowStockOnly(e.target.checked)} aria-label="Low stock only" />
            Low stock only
          </label>
          <Button variant="secondary" onClick={handleExport}>
            Export CSV
          </Button>
          <DropdownMenu
            trigger={({ toggle, open }) => (
              <Button variant="primary" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
                <Plus className="size-4 inline -mt-0.5 mr-1" />
                New ingredient
                <ChevronDown className="size-3.5 inline ml-1 -mt-0.5" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setCreating(true);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  New ingredient
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    close();
                    setImporting(true);
                  }}
                  className="flex w-full items-center gap-2 px-3.5 py-2 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Upload className="size-3.5" />
                  Import CSV
                </button>
              </>
            )}
          </DropdownMenu>
        </div>
      </div>
      <p className="text-sm text-zinc-500 -mt-2 mb-4">
        These items do not appear for sale
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Name</TH>
            <TH className="w-32">Category</TH>
            <TH className="w-24">Unit</TH>
            <TH className="w-40">Stock</TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {ingredients === null ? (
            <tr>
              <td colSpan={8}>
                <TableSkeleton rows={3} cols={8} />
              </td>
            </tr>
          ) : visibleIngredients.length === 0 ? (
            <tr>
              <td colSpan={8}>
                <EmptyState
                  title={lowStockOnly ? "Nothing is low on stock" : "No ingredients yet"}
                  description={
                    lowStockOnly
                      ? "Every ingredient with an alert threshold set is above it right now."
                      : "Raw materials you want to track stock of will show up here."
                  }
                />
              </td>
            </tr>
          ) : (
            visibleIngredients.map((ingredient) => {
              const lowStock =
                ingredient.stockQuantity !== null &&
                ingredient.lowStockThreshold !== null &&
                ingredient.stockQuantity <= ingredient.lowStockThreshold;
              return (
                <TR key={ingredient.id}>
                  <TD className="font-medium">
                    <div className="flex items-center gap-3">
                      <Thumbnail src={ingredient.image} size="size-10" />
                      <span>{ingredient.name}</span>
                    </div>
                  </TD>
                  <TD className="text-zinc-500 text-xs">{ingredient.categoryName ?? "-"}</TD>
                  <TD className="text-zinc-500">{ingredient.unit}</TD>
                  <TD>
                    {ingredient.stockQuantity !== null ? (
                      <span
                        className={
                          lowStock
                            ? "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                            : ""
                        }
                      >
                        {ingredient.stockQuantity} {ingredient.unit}
                        {lowStock ? " (low stock)" : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-400">Pick a branch to see stock</span>
                    )}
                  </TD>
                  <TD>
                    <button
                      onClick={() => setEditing(ingredient)}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label={`Edit ${ingredient.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </TD>
                  <TD>
                    {selectedOutletId && (
                      <button
                        onClick={() => setAdjusting(ingredient)}
                        className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Adjust stock for ${ingredient.name}`}
                      >
                        <SlidersHorizontal className="size-4" />
                      </button>
                    )}
                  </TD>
                  <TD>
                    <button
                      onClick={() => setTransferring(ingredient)}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label={`Transfer stock for ${ingredient.name}`}
                    >
                      <ArrowLeftRight className="size-4" />
                    </button>
                  </TD>
                  <TD>
                    <button
                      onClick={() => handleDelete(ingredient)}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      aria-label={`Delete ${ingredient.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {(creating || editing) && (
        <IngredientFormModal
          ingredient={editing}
          categories={categories}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}

      {transferring && (
        <TransferStockModal
          target={{ kind: "ingredient", ingredient: transferring }}
          onClose={() => setTransferring(null)}
          onTransferred={() => {
            setTransferring(null);
            refresh();
          }}
        />
      )}

      {adjusting && selectedOutletId && (
        <AdjustStockModal
          target={{ kind: "ingredient", ingredient: adjusting }}
          outletId={selectedOutletId}
          outletName={outlets.find((o) => o.id === selectedOutletId)?.name ?? ""}
          onClose={() => setAdjusting(null)}
          onAdjusted={refresh}
        />
      )}

      {importing && (
        <CsvImportModal
          title="Import ingredients"
          previewFn={previewImportIngredients}
          confirmFn={(file) => confirmImportIngredients(file, selectedOutletId ?? undefined)}
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}
    </PageShell>
  );
}
