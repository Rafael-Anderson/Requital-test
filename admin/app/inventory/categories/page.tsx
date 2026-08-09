"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteIngredientCategory, listIngredientCategories } from "@/lib/api";
import type { IngredientCategory } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import IngredientCategoryFormModal from "@/components/IngredientCategoryFormModal";
import InventoryTabs from "@/components/InventoryTabs";
import PageShell from "@/components/ui/PageShell";

export default function IngredientCategoriesPage() {
  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<IngredientCategory | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    try {
      setIngredientCategories(await listIngredientCategories());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load ingredient categories");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleDelete(category: IngredientCategory) {
    deleteWithUndo({
      id: category.id,
      label: `"${category.name}"`,
      onRemoveLocally: () =>
        setIngredientCategories((prev) => (prev ? prev.filter((c) => c.id !== category.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteIngredientCategory(category.id),
    });
  }

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory" />
      <InventoryTabs />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Ingredient Categories</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New category
        </Button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="rounded-lg border border-black/10 dark:border-white/10 overflow-hidden">
        {ingredientCategories === null ? (
          <TableSkeleton rows={4} cols={2} />
        ) : ingredientCategories.length === 0 ? (
          <EmptyState
            title="No ingredient categories yet"
            description="Create categories to organize raw materials: flowers, packaging, add-ons."
          />
        ) : (
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {ingredientCategories.map((c) => (
              <div
                key={c.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
              >
                <span className="text-sm font-medium">{c.name}</span>
                <div className="flex gap-1">
                  <button
                    onClick={() => setEditing(c)}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label={`Edit ${c.name}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(c)}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    aria-label={`Delete ${c.name}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <IngredientCategoryFormModal
          category={editing}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
