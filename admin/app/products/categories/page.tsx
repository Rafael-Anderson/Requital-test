"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Pencil, Plus, Trash2 } from "lucide-react";
import { deleteCollection, listCollections, reorderCollections } from "@/lib/api";
import { buildCollectionTree, flattenCollectionTree, type Collection } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import CollectionFormModal from "@/components/CollectionFormModal";
import { CollectionImportButton } from "@/components/ListImportButtons";
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

  // `latest` drops a response a newer refresh has superseded; a failure ends in
  // an error with Try again.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listCollections()
      .then((list) => {
        if (mine !== latest.current) return;
        setCollections(list);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load collections");
      });
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

      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <div className="flex flex-wrap items-center gap-2">
          <CollectionImportButton onImported={refresh} />
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus className="size-4 inline -mt-0.5 me-1" />
            New collection
          </Button>
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <div className="rounded-lg border border-border dark:border-white/10 overflow-hidden">
        {collections === null ? (
          error ? (
            <LoadFailed what="collections" onRetry={refresh} />
          ) : (
            <TableSkeleton rows={4} cols={3} />
          )
        ) : rows.length === 0 ? (
          <EmptyState
            title="No collections yet"
            description="Create collections to organize your product catalog."
          />
        ) : (
          // Nesting guides live in each row's OWN gutter: one fixed-width cell per level,
          // before the drag handle, with a logical start border (so it mirrors in RTL).
          // They are siblings of the handle and the text, never drawn behind them, so a
          // guide cannot cross either one, and the cells stretch the full row height so the
          // line is continuous from row to row.
          <div className="divide-y divide-black/5 dark:divide-white/10">
            {rows.map((c) => (
              <div
                key={c.id}
                draggable
                onDragStart={() => setDraggedId(c.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => handleDrop(c.id)}
                data-testid="collection-row"
                className={`flex items-stretch justify-between ps-4 pe-4 hover:bg-black/[0.02] dark:hover:bg-white/[0.03] transition-colors ${
                  draggedId === c.id ? "opacity-40" : ""
                }`}
              >
                <div className="flex min-w-0 flex-1 items-stretch">
                  {c.depth > 0 && (
                    <div className="flex shrink-0 items-stretch" data-testid="tree-gutter" aria-hidden>
                      {Array.from({ length: c.depth }, (_, level) => (
                        <span key={level} className="w-5 shrink-0 border-s border-black/10 dark:border-white/15" />
                      ))}
                    </div>
                  )}
                  <div className="flex min-w-0 items-center gap-2 py-2.5 ps-2 text-sm">
                    <span className="cursor-grab active:cursor-grabbing text-text-faint shrink-0" aria-hidden>
                      <GripVertical className="size-4" />
                    </span>
                    <span className="font-medium">{c.name}</span>
                    <span className="text-text-faint ms-2 text-xs">{c.slug}</span>
                    {c.collectionType === "automated" && (
                      <span className="ms-2 rounded-md bg-black/5 px-1.5 py-0.5 text-[11px] font-medium text-text-muted dark:bg-white/10">Automated</span>
                    )}
                  </div>
                </div>
                <div className="flex gap-1 self-center">
                  <Tooltip label={`Edit ${c.name}`}>
                    <button
                      onClick={() => setEditing(c)}
                      className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      aria-label={`Edit ${c.name}`}
                    >
                      <Pencil className="size-4" />
                    </button>
                  </Tooltip>
                  <Tooltip label={`Delete ${c.name}. This cannot be undone.`} align="end">
                    <button
                      onClick={() => handleDelete(c)}
                      className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
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
