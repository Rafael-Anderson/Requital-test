"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowLeftRight, ChevronDown, Copy, Pencil, Plus, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import {
  bulkDeleteProducts,
  bulkUpdateProductStatus,
  confirmImportProducts,
  deleteProduct,
  duplicateProduct,
  listCollections,
  listProducts,
  previewImportProducts,
  updateProductAvailability,
} from "@/lib/api";
import {
  buildCollectionTree,
  flattenCollectionTree,
  PRODUCT_STATUS_LABELS,
  type Collection,
  type Product,
} from "@/lib/types";
import TransferStockModal from "@/components/TransferStockModal";
import AdjustStockModal from "@/components/AdjustStockModal";
import BulkPriceUpdateModal from "@/components/BulkPriceUpdateModal";
import CsvImportModal from "@/components/CsvImportModal";
import DropdownMenu from "@/components/ui/DropdownMenu";
import { useOutletFilter } from "@/lib/outlet-context";
import { useRowSelection } from "@/lib/useRowSelection";
import { downloadCsv } from "@/lib/csv";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import Select from "@/components/ui/Select";
import BulkActionBar from "@/components/ui/BulkActionBar";
import Thumbnail from "@/components/ui/Thumbnail";
import { useToast } from "@/components/ui/Toast";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import ProductsTabs from "@/components/ProductsTabs";
import PageShell from "@/components/ui/PageShell";
import Tooltip from "@/components/ui/Tooltip";

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  // Seeded from ?collection=<id> so homepage shortcut tiles can deep-link into
  // an already-filtered list; purely the initial value — changing the
  // dropdown afterward doesn't write back to the URL.
  const [collectionFilter, setCollectionFilter] = useState(searchParams.get("collection") ?? "");
  const [transferringProduct, setTransferringProduct] = useState<Product | null>(null);
  const [adjustingProduct, setAdjustingProduct] = useState<Product | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const deleteWithUndo = useUndoableDelete();
  const { selectedOutletId, outlets } = useOutletFilter();

  const refresh = useCallback(async () => {
    try {
      const [productList, collectionList] = await Promise.all([
        listProducts(selectedOutletId ?? undefined),
        listCollections(),
      ]);
      setProducts(productList);
      setCollections(collectionList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    }
  }, [selectedOutletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const collectionRows = useMemo(() => flattenCollectionTree(buildCollectionTree(collections)), [collections]);
  const visibleProducts = useMemo(() => {
    if (!products) return null;
    let result = products;
    if (collectionFilter) {
      const id = Number(collectionFilter);
      result = result.filter((p) => p.collections.some((c) => c.id === id));
    }
    return result;
  }, [products, collectionFilter]);

  const visibleIds = useMemo(() => (visibleProducts ?? []).map((p) => p.id), [visibleProducts]);
  const selection = useRowSelection(visibleIds);
  const [bulkStatus, setBulkStatus] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkPricing, setBulkPricing] = useState(false);
  const [importing, setImporting] = useState(false);

  async function handleToggleStatus(product: Product) {
    const nextStatus = product.status === "Available" ? "Unavailable" : "Available";
    try {
      await updateProductAvailability(product.id, nextStatus);
      toast(nextStatus === "Available" ? `${product.name} is now active` : `${product.name} is now disabled`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update product", "error");
    }
  }

  function handleDelete(product: Product) {
    deleteWithUndo({
      id: product.id,
      label: `"${product.name}"`,
      onRemoveLocally: () => setProducts((prev) => (prev ? prev.filter((p) => p.id !== product.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteProduct(product.id),
    });
  }

  // Lands on the copy's own edit page (matches other duplicate-then-edit
  // flows) rather than just refreshing the list — it's created as a Draft
  // with a placeholder SKU, so the natural next step is to fix those up.
  async function handleDuplicate(product: Product) {
    try {
      const copy = await duplicateProduct(product.id);
      toast(`Duplicated "${product.name}"`);
      router.push(`/products/${copy.id}/edit`);
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to duplicate product", "error");
    }
  }

  async function handleBulkStatus() {
    if (!bulkStatus) {
      toast("Pick a status", "error");
      return;
    }
    setBulkBusy(true);
    try {
      const { updated } = await bulkUpdateProductStatus(selection.selectedIds, bulkStatus);
      toast(`Updated ${updated} product${updated === 1 ? "" : "s"}`);
      setBulkStatus("");
      selection.clear();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update products", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  // Confirm-based, not the toast+undo pattern (#5) — explicitly out of
  // scope for bulk delete per the task: this is bulk-irreversible, an
  // accidental "keep the window open 6s" isn't enough friction for
  // potentially hundreds of rows at once.
  async function handleBulkDelete() {
    if (!confirm(`Delete ${selection.selectedIds.length} product(s)? This cannot be undone.`)) return;
    setBulkBusy(true);
    try {
      const { succeeded, results } = await bulkDeleteProducts(selection.selectedIds);
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        toast(`Deleted ${succeeded}, ${failed.length} failed (likely have order history)`, "error");
      } else {
        toast(`Deleted ${succeeded} product${succeeded === 1 ? "" : "s"}`);
      }
      selection.clear();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to delete products", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  // Column order matches PRODUCT_IMPORT_HEADERS in backend/src/products/
  // products-import.ts exactly — this is also the shape "Import CSV" reads
  // back, so re-importing an unmodified export is a no-op round trip. Only
  // reachable from the bulk action bar (a selection always exists here).
  function handleBulkExport() {
    const source = (visibleProducts ?? []).filter((p) => selection.selected.has(p.id));
    const rows: unknown[][] = [];
    for (const p of source) {
      const base = [
        p.slug,
        p.name,
        p.description ?? "",
        p.sku,
        p.barcode ?? "",
        p.price,
        p.compareAtPrice ?? "",
        p.costPrice ?? "",
        p.status,
        p.trackInventory,
        p.chargeTax,
        p.vendor ?? "",
        p.productType ?? "",
        p.thumbnail,
        p.collections.map((c) => c.name).join("; "),
        p.tags.join("; "),
      ];
      // A variant-bearing product's own Stock column is meaningless (stock
      // lives per-variant, not on the product) — only a simple product's row
      // carries it.
      if (p.variants.length === 0) {
        rows.push([...base, "", "", "", "", p.stockQuantity ?? ""]);
      } else {
        for (const v of p.variants) {
          rows.push([...base, v.label ?? "", v.sku ?? "", v.price ?? "", v.compareAtPrice ?? "", v.stockQuantity ?? ""]);
        }
      }
    }
    downloadCsv(
      `products-${new Date().toISOString().slice(0, 10)}.csv`,
      [
        "Handle",
        "Name",
        "Description",
        "SKU",
        "Barcode",
        "Price",
        "Compare At Price",
        "Cost Price",
        "Status",
        "Track Inventory",
        "Charge Tax",
        "Vendor",
        "Product Type",
        "Thumbnail URL",
        "Collections",
        "Tags",
        "Variant",
        "Variant SKU",
        "Variant Price",
        "Variant Compare At Price",
        "Stock",
      ],
      rows,
    );
    toast(`Exported ${source.length} product${source.length === 1 ? "" : "s"}`);
  }

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/" />} />
      <ProductsTabs />
      <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Products</h1>
        <div className="flex items-center gap-2">
          <div className="w-44">
            <Select
              value={collectionFilter}
              onChange={(e) => setCollectionFilter(e.target.value)}
              aria-label="Filter by collection"
            >
              <option value="">All collections</option>
              {collectionRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {"- ".repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <DropdownMenu
            trigger={({ toggle, open }) => (
              <Button variant="primary" onClick={toggle} aria-haspopup="menu" aria-expanded={open}>
                <Plus className="size-4 inline -mt-0.5 mr-1" />
                New product
                <ChevronDown className="size-3.5 inline ml-1 -mt-0.5" />
              </Button>
            )}
          >
            {(close) => (
              <>
                <Link
                  href="/products/new"
                  role="menuitem"
                  onClick={close}
                  className="flex items-center gap-2 px-3.5 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Plus className="size-3.5" />
                  New product
                </Link>
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
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <BulkActionBar count={selection.selectedIds.length} onClear={selection.clear}>
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value)}
          className="border border-border dark:border-white/15 rounded-[10px] px-2 py-1.5 text-sm bg-surface dark:bg-zinc-900 cursor-pointer"
        >
          <option value="">Set status…</option>
          {Object.keys(PRODUCT_STATUS_LABELS).map((s) => (
            <option key={s} value={s}>
              {PRODUCT_STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={handleBulkStatus} disabled={bulkBusy}>
          Apply
        </Button>
        <Button size="sm" variant="secondary" onClick={() => setBulkPricing(true)} disabled={bulkBusy}>
          Adjust prices
        </Button>
        <Button size="sm" variant="secondary" onClick={handleBulkExport} disabled={bulkBusy}>
          Export CSV
        </Button>
        <Button size="sm" variant="danger" onClick={handleBulkDelete} disabled={bulkBusy}>
          Delete
        </Button>
      </BulkActionBar>

      <Table>
        <THead>
          <tr>
            <TH className="w-8">
              <Checkbox
                checked={selection.allSelected}
                onChange={selection.toggleAll}
                aria-label="Select all products"
              />
            </TH>
            <TH>Product</TH>
            <TH className="w-20">Price</TH>
            <TH className="w-20">SKU</TH>
            <TH className="w-24">Total sales</TH>
            <TH className="w-56">Collections</TH>
            <TH className="w-28">Status</TH>
            <TH className="w-24">Stock</TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {visibleProducts === null ? (
            <tr>
              <td colSpan={13}>
                <TableSkeleton rows={5} cols={13} />
              </td>
            </tr>
          ) : visibleProducts.length === 0 && !error ? (
            <tr>
              <td colSpan={13}>
                <EmptyState
                  title="No products yet"
                  description="Products you add to the catalog will show up here."
                />
              </td>
            </tr>
          ) : (
            visibleProducts.map((p) => {
              const lowStock =
                p.trackInventory &&
                p.stockQuantity !== null &&
                p.lowStockThreshold !== null &&
                p.stockQuantity <= p.lowStockThreshold;
              const active = p.status === "Available";
              return (
                <TR key={p.id}>
                  <TD>
                    <Checkbox
                      checked={selection.selected.has(p.id)}
                      onChange={() => selection.toggle(p.id)}
                      aria-label={`Select ${p.name}`}
                    />
                  </TD>
                  <TD>
                    <div className="flex items-center gap-3">
                      <Thumbnail src={p.thumbnail} size="size-10" />
                      <span className="text-sm font-semibold text-text-primary dark:text-zinc-100">{p.name}</span>
                      {p.isGiftCard && (
                        <span className="inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400">
                          Gift card
                        </span>
                      )}
                    </div>
                  </TD>
                  <TD className="text-[13.5px]">{p.price} AED</TD>
                  <TD className="text-text-muted">{p.sku}</TD>
                  <TD className="text-text-muted">{p.totalSold} sold</TD>
                  <TD className="text-xs text-text-muted">
                    {p.collections.length > 0 ? p.collections.map((c) => c.name).join(", ") : "-"}
                  </TD>
                  <TD>
                    <button
                      onClick={() => handleToggleStatus(p)}
                      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold transition-colors cursor-pointer ${
                        active
                          ? "bg-accent-tint text-accent-text hover:bg-accent-mid/40 dark:bg-accent/15 dark:text-accent"
                          : "bg-neutral-chip-bg text-neutral-chip-text hover:bg-border dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {active ? "Active" : "Disabled"}
                    </button>
                  </TD>
                  <TD>
                    {p.trackInventory && p.stockQuantity !== null ? (
                      <span className={`text-[13.5px] ${lowStock ? "font-bold text-danger-text" : ""}`}>
                        {p.stockQuantity}
                        {lowStock ? " (low)" : ""}
                      </span>
                    ) : (
                      <span className="text-text-faint">-</span>
                    )}
                    {/* Bill of Materials — informational only, doesn't gate the
                        Active toggle or checkout (see backend
                        ProductsService.consumeForOrderItems's own comment on
                        why enforcing this is deferred). Only shown when the
                        recipe is actually the binding constraint — a
                        makeableQuantity that isn't lower than the product's
                        own stock number is just noise here. */}
                    {p.makeableQuantity !== null &&
                      p.stockQuantity !== null &&
                      p.makeableQuantity < p.stockQuantity && (
                        <div className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">
                          only {p.makeableQuantity} can be made (limited by {p.limitedByIngredient})
                        </div>
                      )}
                  </TD>
                  <TD>
                    <Tooltip label={`Edit ${p.name}`}>
                      <Link
                        href={`/products/${p.id}/edit`}
                        className="inline-flex p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors"
                        aria-label={`Edit ${p.name}`}
                      >
                        <Pencil className="size-4" />
                      </Link>
                    </Tooltip>
                  </TD>
                  <TD>
                    {p.trackInventory && selectedOutletId && (
                      <Tooltip label={`Adjust stock for ${p.name}`}>
                        <button
                          onClick={() => setAdjustingProduct(p)}
                          className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                          aria-label={`Adjust stock for ${p.name}`}
                        >
                          <SlidersHorizontal className="size-4" />
                        </button>
                      </Tooltip>
                    )}
                  </TD>
                  <TD>
                    <Tooltip label={`Transfer stock for ${p.name} to another branch`}>
                      <button
                        onClick={() => setTransferringProduct(p)}
                        className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Transfer stock for ${p.name}`}
                      >
                        <ArrowLeftRight className="size-4" />
                      </button>
                    </Tooltip>
                  </TD>
                  <TD>
                    <Tooltip label={`Create a copy of ${p.name}`}>
                      <button
                        onClick={() => handleDuplicate(p)}
                        className="p-1.5 rounded text-text-muted hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                        aria-label={`Duplicate ${p.name}`}
                      >
                        <Copy className="size-4" />
                      </button>
                    </Tooltip>
                  </TD>
                  <TD>
                    <Tooltip label={`Delete ${p.name}. This cannot be undone.`} align="end">
                      <button
                        onClick={() => handleDelete(p)}
                        className="p-1.5 rounded text-text-muted hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                        aria-label={`Delete ${p.name}`}
                      >
                        <Trash2 className="size-4" />
                      </button>
                    </Tooltip>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {transferringProduct && (
        <TransferStockModal
          target={{ kind: "product", product: transferringProduct }}
          onClose={() => setTransferringProduct(null)}
          onTransferred={() => {
            setTransferringProduct(null);
            refresh();
          }}
        />
      )}

      {adjustingProduct && selectedOutletId && (
        <AdjustStockModal
          target={{ kind: "product", product: adjustingProduct }}
          outletId={selectedOutletId}
          outletName={outlets.find((o) => o.id === selectedOutletId)?.name ?? ""}
          onClose={() => setAdjustingProduct(null)}
          onAdjusted={refresh}
        />
      )}

      {bulkPricing && (
        <BulkPriceUpdateModal
          products={(visibleProducts ?? []).filter((p) => selection.selected.has(p.id))}
          onClose={() => setBulkPricing(false)}
          onApplied={() => {
            setBulkPricing(false);
            selection.clear();
            refresh();
          }}
        />
      )}

      {importing && (
        <CsvImportModal
          title="Import products"
          previewFn={previewImportProducts}
          confirmFn={(file) => confirmImportProducts(file, selectedOutletId ?? undefined)}
          onClose={() => setImporting(false)}
          onImported={refresh}
        />
      )}
    </PageShell>
  );
}
