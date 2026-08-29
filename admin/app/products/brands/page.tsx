"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Search, Trash2 } from "lucide-react";
import { deleteBrand, listBrands } from "@/lib/api";
import type { Brand } from "@/lib/types";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import PageShell from "@/components/ui/PageShell";
import { TableSkeleton } from "@/components/ui/Skeleton";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Thumbnail from "@/components/ui/Thumbnail";
import Tooltip from "@/components/ui/Tooltip";
import ProductsTabs from "@/components/ProductsTabs";
import BrandFormModal from "@/components/BrandFormModal";

export default function BrandsPage() {
  const [brands, setBrands] = useState<Brand[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<Brand | null>(null);
  const [creating, setCreating] = useState(false);
  const deleteWithUndo = useUndoableDelete();

  const refresh = useCallback(async () => {
    try {
      setBrands(await listBrands());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load brands");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function handleDelete(brand: Brand) {
    deleteWithUndo({
      id: brand.id,
      label: `"${brand.name}"`,
      onRemoveLocally: () =>
        setBrands((prev) => (prev ? prev.filter((b) => b.id !== brand.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteBrand(brand.id),
    });
  }

  const filtered = (brands ?? []).filter((b) =>
    b.name.toLowerCase().includes(search.trim().toLowerCase()),
  );

  return (
    <PageShell variant="wide">
      <BackButton href="/products" />
      <ProductsTabs />

      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">Brands</h1>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          Add Brand
        </Button>
      </div>

      <p className="text-sm text-text-muted mb-4">
        Group products by brand or manufacturer. Shoppers can filter your storefront by brand.
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      {brands !== null && brands.length > 0 && (
        <div className="relative w-full sm:w-72 mb-3">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-text-faint" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search brands"
            className="w-full h-9 rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      )}

      {brands === null ? (
        <TableSkeleton rows={4} cols={3} />
      ) : brands.length === 0 ? (
        <EmptyState
          title="No brands yet"
          description="Add a brand to start organizing your catalog by manufacturer."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-16">Logo</TH>
              <TH>Brand Name</TH>
              <TH className="w-24 text-right">Actions</TH>
            </TR>
          </THead>
          <TBody>
            {filtered.map((brand) => (
              <TR key={brand.id}>
                <TD>
                  <Thumbnail src={brand.logoUrl} size="size-8" />
                </TD>
                <TD className="font-medium">{brand.name}</TD>
                <TD>
                  <div className="flex justify-end gap-1">
                    <Tooltip label={`Edit ${brand.name}`}>
                      <button
                        onClick={() => setEditing(brand)}
                        aria-label={`Edit ${brand.name}`}
                        className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                      >
                        <Pencil className="size-4" />
                      </button>
                    </Tooltip>
                    <Tooltip label={`Delete ${brand.name}`} align="end">
                      <button
                        onClick={() => handleDelete(brand)}
                        aria-label={`Delete ${brand.name}`}
                        className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Tooltip>
                  </div>
                </TD>
              </TR>
            ))}
            {filtered.length === 0 && (
              <TR>
                <TD colSpan={3} className="text-center text-text-muted py-6">
                  No brands match &ldquo;{search}&rdquo;.
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      )}

      {(creating || editing) && (
        <BrandFormModal
          brand={editing}
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
