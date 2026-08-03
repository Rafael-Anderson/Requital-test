"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import {
  deleteCategory,
  deleteIngredientCategory,
  listCategories,
  listIngredientCategories,
} from "@/lib/api";
import { buildCategoryTree, flattenCategoryTree, type Category, type IngredientCategory } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import CategoryFormModal from "@/components/CategoryFormModal";
import IngredientCategoryFormModal from "@/components/IngredientCategoryFormModal";
import InventoryTabs from "@/components/InventoryTabs";
import PageShell from "@/components/ui/PageShell";

export default function CategoriesPage() {
  const [categories, setCategories] = useState<Category[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Category | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteWithUndo = useUndoableDelete();

  const [ingredientCategories, setIngredientCategories] = useState<IngredientCategory[] | null>(null);
  const [ingredientCategoriesError, setIngredientCategoriesError] = useState<string | null>(null);
  const [editingIngredientCategory, setEditingIngredientCategory] = useState<IngredientCategory | null>(null);
  const [creatingIngredientCategory, setCreatingIngredientCategory] = useState(false);
  const deleteIngredientCategoryWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    try {
      setCategories(await listCategories());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load categories");
    }
  }, []);

  const refreshIngredientCategories = useCallback(async () => {
    try {
      setIngredientCategories(await listIngredientCategories());
      setIngredientCategoriesError(null);
    } catch (err) {
      setIngredientCategoriesError(err instanceof Error ? err.message : "Failed to load ingredient categories");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  useEffect(() => {
    refreshIngredientCategories();
  }, [refreshIngredientCategories]);

  function handleDelete(category: Category) {
    deleteWithUndo({
      id: category.id,
      label: `"${category.name}"`,
      onRemoveLocally: () => setCategories((prev) => (prev ? prev.filter((c) => c.id !== category.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteCategory(category.id),
    });
  }

  function handleDeleteIngredientCategory(category: IngredientCategory) {
    deleteIngredientCategoryWithUndo({
      id: category.id,
      label: `"${category.name}"`,
      onRemoveLocally: () =>
        setIngredientCategories((prev) => (prev ? prev.filter((c) => c.id !== category.id) : prev)),
      onRestoreLocally: refreshIngredientCategories,
      commit: () => deleteIngredientCategory(category.id),
    });
  }

  const rows = categories ? flattenCategoryTree(buildCategoryTree(categories)) : [];

  return (
    <PageShell variant="wide">
      <BackButton href="/inventory" />
      <InventoryTabs />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold">Product Categories</h1>
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              New category
            </Button>
          </div>

          {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

          <div className="rounded-lg border dark:border-white/10 overflow-hidden">
            {categories === null ? (
              <TableSkeleton rows={4} cols={3} />
            ) : rows.length === 0 ? (
              <EmptyState
                title="No categories yet"
                description="Create categories to organize your product catalog."
              />
            ) : (
              // Vertical guide-line technique adapted from Origin UI's
              // "basic-tree-with-vertical-lines" on 21st.dev
              // (https://21st.dev/@originui/components/tree/basic-tree-with-vertical-lines),
              // same as CategoryCheckboxTree — kept consistent between the two
              // category-tree views in the app. Pseudo-element width is capped to
              // the deepest nesting present, since the gradient tiles infinitely
              // otherwise and would draw guide lines across the full row width.
              <div
                className="relative divide-y divide-black/5 dark:divide-white/10 before:absolute before:top-0 before:bottom-0 before:left-0 before:-ml-1 before:w-(--tree-guide-width) before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),rgba(0,0,0,0.08)_calc(var(--tree-indent)-1px),rgba(0,0,0,0.08)_calc(var(--tree-indent)))] dark:before:bg-[repeating-linear-gradient(to_right,transparent_0,transparent_calc(var(--tree-indent)-1px),rgba(255,255,255,0.12)_calc(var(--tree-indent)-1px),rgba(255,255,255,0.12)_calc(var(--tree-indent)))]"
                style={
                  {
                    "--tree-indent": "20px",
                    "--tree-guide-width": `${(Math.max(...rows.map((r) => r.depth)) + 1) * 20}px`,
                  } as React.CSSProperties
                }
              >
                {rows.map((c) => (
                  <div
                    key={c.id}
                    className="relative z-10 flex items-center justify-between px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <div style={{ paddingLeft: `${c.depth * 20 + 8}px` }} className="text-sm">
                      <span className="font-medium">{c.name}</span>
                      <span className="text-zinc-400 ml-2 text-xs">{c.slug}</span>
                    </div>
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
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-2xl font-semibold">Ingredient Categories</h1>
            <Button variant="primary" onClick={() => setCreatingIngredientCategory(true)}>
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              New category
            </Button>
          </div>

          {ingredientCategoriesError && <p className="text-red-600 text-sm mb-3">{ingredientCategoriesError}</p>}

          <div className="rounded-lg border dark:border-white/10 overflow-hidden">
            {ingredientCategories === null ? (
              <TableSkeleton rows={4} cols={2} />
            ) : ingredientCategories.length === 0 ? (
              <EmptyState
                title="No ingredient categories yet"
                description="Create categories to organize raw materials — flowers, packaging, add-ons."
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
                        onClick={() => setEditingIngredientCategory(c)}
                        className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Edit ${c.name}`}
                      >
                        <Pencil className="size-4" />
                      </button>
                      <button
                        onClick={() => handleDeleteIngredientCategory(c)}
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
        </div>
      </div>

      {(creating || editing) && (
        <CategoryFormModal
          category={editing}
          categories={categories ?? []}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSaved={refresh}
        />
      )}

      {(creatingIngredientCategory || editingIngredientCategory) && (
        <IngredientCategoryFormModal
          category={editingIngredientCategory}
          onClose={() => {
            setCreatingIngredientCategory(false);
            setEditingIngredientCategory(null);
          }}
          onSaved={refreshIngredientCategories}
        />
      )}
    </PageShell>
  );
}
