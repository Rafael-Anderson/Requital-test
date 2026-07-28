"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteCollection, listCollections } from "@/lib/api";
import { COLLECTION_TYPE_LABELS, type Collection } from "@/lib/types";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import PageShell from "@/components/ui/PageShell";

export default function CollectionsPage() {
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const deleteWithUndo = useUndoableDelete();

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
      label: `"${collection.title}"`,
      onRemoveLocally: () => setCollections((prev) => (prev ? prev.filter((c) => c.id !== collection.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteCollection(collection.id),
    });
  }

  return (
    <PageShell>
      <BackButton href="/" />
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-2xl font-semibold">Collections</h1>
        <Link href="/collections/new">
          <Button variant="primary">
            <Plus className="size-4 inline -mt-0.5 mr-1" />
            New collection
          </Button>
        </Link>
      </div>
      <p className="text-sm text-zinc-500 mb-4">
        Marketing groupings that cut across categories — &quot;Summer Sale&quot;, &quot;New Arrivals&quot;, and similar.
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Title</TH>
            <TH className="w-48">Type</TH>
            <TH className="w-24">Products</TH>
            <TH className="w-20">Status</TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {collections === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={3} cols={6} />
              </td>
            </tr>
          ) : collections.length === 0 ? (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  title="No collections yet"
                  description="Group products for marketing campaigns, independent of your category tree."
                />
              </td>
            </tr>
          ) : (
            collections.map((c) => (
              <TR key={c.id}>
                <TD className="font-medium">{c.title}</TD>
                <TD className="text-zinc-500">{COLLECTION_TYPE_LABELS[c.type]}</TD>
                <TD className="text-zinc-500">{c.productCount}</TD>
                <TD>
                  <span
                    className={`text-xs rounded px-2 py-1 border ${
                      c.isActive
                        ? "border-green-400 text-green-700 dark:text-green-400"
                        : "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400"
                    }`}
                  >
                    {c.isActive ? "Active" : "Inactive"}
                  </span>
                </TD>
                <TD>
                  <Link
                    href={`/collections/${c.id}/edit`}
                    className="inline-flex p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                    aria-label={`Edit ${c.title}`}
                  >
                    <Pencil className="size-4" />
                  </Link>
                </TD>
                <TD>
                  <button
                    onClick={() => handleDelete(c)}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    aria-label={`Delete ${c.title}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
