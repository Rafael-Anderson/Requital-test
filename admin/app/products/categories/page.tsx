"use client";

import { useCallback, useEffect, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteCollection, listCollections, reorderCollections } from "@/lib/api";
import { buildCollectionTree, flattenCollectionTree, type Collection } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import CollectionFormModal from "@/components/CollectionFormModal";
import ProductsTabs from "@/components/ProductsTabs";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";
import Tooltip from "@/components/ui/Tooltip";

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Collection | null>(null);
  const [creating, setCreating] = useState(false);
  const [draggedId, setDraggedId] = useState<number | null>(null);
  const deleteWithUndo = useUndoableDelete();
  const toast = useToast();

  const refresh = useCallback(async () => {
    try {
      setCollections(await listCollections());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load collections");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleDelete(collection: Collection) {
    deleteWithUndo({
      id: collection.id,
      label: `"${collection.name}"`,
      onRemoveLocally: () => setCollections((prev) => (prev ? prev.filter((c) => c.id !== collection.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteCollection(collection.id),
    });
  }

  const rows = collections ? flattenCollectionTree(buildCollectionTree(collections)) : [];

  // Native HTML5 drag-and-drop, same pattern as BioLinksPage (the sole other
  // real-drag-reorder case in this app). Reorders the flattened rows the
  // tree already renders; each sibling group re-sorts by the new global
  // displayOrder once persisted, so a drag within a visible sibling group
  // produces the expected result.
  function handleDrop(targetId: number) {
    if (draggedId === null || draggedId === targetId || !collections) {
      setDraggedId(null);
      return;
    }
    const fromIndex = rows.findIndex((c) => c.id === draggedId);
    const toIndex = rows.findIndex((c) => c.id === targetId);
    const reorderedRows = [...rows];
    const [moved] = reorderedRows.splice(fromIndex, 1);
    reorderedRows.splice(toIndex, 0, moved);
    const orderById = new Map(reorderedRows.map((c, i) => [c.id, i]));
    setCollections(
      collections
        .map((c) => ({ ...c, displayOrder: orderById.get(c.id) ?? c.displayOrder }))
        .sort((a, b) => a.displayOrder - b.displayOrder),
    );
    setDraggedId(null);
    reorderCollections(reorderedRows.map((c) => c.id)).catch((err) => {
      toast(err instanceof Error ? err.message : "Failed to save new order", "error");
      refresh();
    });
  }

  return (
    <PageShell variant="wide">
      <BackButton href="/products" />
      <ProductsTabs />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New collection
        </Button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="rounded-lg border dark:border-white/10 overflow-hidden">
        {collections === null ? (
          <TableSkeleton rows={4} cols={3} />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No collections yet"
            description="Create collections to organize your product catalog."
          />
        ) : (
          // Vertical guide-line technique adapted from Origin UI's
          // "basic-tree-with-vertical-lines" on 21st.dev
          // (https://21st.dev/@originui/components/tree/basic-tree-with-vertical-lines),
          // same as CollectionCheckboxTree — kept consistent between the two
          // collection-tree views in the app. Pseudo-element width is capped to
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
                draggable
                onDragStart={() => setDraggedId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(c.id)}
                className={`relative z-10 flex items-center justify-between px-4 py-2.5 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
                  draggedId === c.id ? "opacity-40" : ""
                }`}
              >
                <div style={{ paddingLeft: `${c.depth * 20 + 8}px` }} className="flex items-center gap-2 text-sm">
                  <span className="cursor-grab active:cursor-grabbing text-zinc-400 shrink-0" aria-hidden>
                    <GripVertical className="size-4" />
                  </span>
                  <span className="font-medium">{c.name}</span>
                  <span className="text-zinc-400 ml-2 text-xs">{c.slug}</span>
                </div>
                <div className="flex gap-1">
                  <Tooltip label={`Edit ${c.name}`}>
                    <button
                      onClick={() => setEditing(c)}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={`Delete ${c.name}. This cannot be undone.`} align="end">
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      aria-label={`Delete ${c.name}`}
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </Tooltip>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(creating || editing) && (
        <CollectionFormModal
          collection={editing}
          collections={collections ?? []}
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
