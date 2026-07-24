"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Plus } from "lucide-react";
import { adjustStock, listCategories, listProducts, updateProduct } from "@/lib/api";
import { buildCategoryTree, flattenCategoryTree, type Category, type Product } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";

export default function InventoryPage() {
  return (
    <Suspense fallback={null}>
      <InventoryPageContent />
    </Suspense>
  );
}

function InventoryPageContent() {
  const searchParams = useSearchParams();
  const [products, setProducts] = useState<Product[] | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  // Seeded from ?category=<id> so homepage shortcut tiles can deep-link into
  // an already-filtered list; purely the initial value — changing the
  // dropdown afterward doesn't write back to the URL.
  const [categoryFilter, setCategoryFilter] = useState(searchParams.get("category") ?? "");
  const [deltas, setDeltas] = useState<Record<number, string>>({});
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();
  const { selectedOutletId, outlets } = useOutletFilter();

  const refresh = useCallback(async () => {
    try {
      const [productList, categoryList] = await Promise.all([
        listProducts(selectedOutletId ?? undefined),
        listCategories(),
      ]);
      setProducts(productList);
      setCategories(categoryList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load products");
    }
  }, [selectedOutletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const categoryRows = useMemo(() => flattenCategoryTree(buildCategoryTree(categories)), [categories]);
  const visibleProducts = useMemo(() => {
    if (!products) return null;
    if (!categoryFilter) return products;
    const id = Number(categoryFilter);
    return products.filter((p) => p.categories.some((c) => c.id === id));
  }, [products, categoryFilter]);

  async function handleAdjust(productId: number) {
    const raw = deltas[productId];
    const delta = Number(raw);
    if (!raw || Number.isNaN(delta) || delta === 0) return;
    if (!selectedOutletId) {
      toast("Pick a branch above before adjusting stock", "error");
      return;
    }
    try {
      await adjustStock([{ productId, delta }], selectedOutletId);
      setDeltas((d) => ({ ...d, [productId]: "" }));
      toast(`Stock ${delta > 0 ? "increased" : "decreased"} by ${Math.abs(delta)}`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to adjust stock", "error");
    }
  }

  async function handleToggleTracking(product: Product) {
    try {
      await updateProduct(product.id, { trackInventory: !product.trackInventory });
      toast(
        product.trackInventory
          ? `${product.name} switched to made-to-order`
          : `${product.name} is now tracked`,
      );
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update product", "error");
    }
  }

  return (
    <div className="page-transition">
      <BackButton fallbackHref="/" />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Inventory</h1>
        <div className="flex items-center gap-2">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="border rounded px-3 py-1.5 text-sm dark:bg-zinc-900 transition-colors hover:border-black/30 dark:hover:border-white/30 cursor-pointer"
          >
            <option value="">All categories</option>
            {categoryRows.map((c) => (
              <option key={c.id} value={c.id}>
                {"— ".repeat(c.depth)}
                {c.name}
              </option>
            ))}
          </select>
          <Link href="/inventory/new">
            <Button variant="primary">
              <Plus className="size-4 inline -mt-0.5 mr-1" />
              New product
            </Button>
          </Link>
        </div>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
      {!selectedOutletId && outlets.length > 0 && (
        <p className="text-sm text-zinc-500 mb-3">
          Stock is tracked per branch — pick one from the switcher above to see or adjust counts.
        </p>
      )}

      <Table>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH>SKU</TH>
            <TH>Price</TH>
            <TH>Categories</TH>
            <TH>Track inventory</TH>
            <TH>Stock</TH>
            <TH>Restock / adjust</TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {visibleProducts === null ? (
            <tr>
              <td colSpan={8}>
                <TableSkeleton rows={5} cols={8} />
              </td>
            </tr>
          ) : visibleProducts.length === 0 && !error ? (
            <tr>
              <td colSpan={8}>
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
              return (
                <TR key={p.id}>
                  <TD>{p.name}</TD>
                  <TD className="text-zinc-500">{p.sku}</TD>
                  <TD>{p.price} AED</TD>
                  <TD className="text-xs text-zinc-500">
                    {p.categories.length > 0 ? p.categories.map((c) => c.name).join(", ") : "—"}
                  </TD>
                  <TD>
                    <button
                      onClick={() => handleToggleTracking(p)}
                      className={`text-xs rounded px-2 py-1 border transition-colors cursor-pointer ${
                        p.trackInventory
                          ? "border-green-400 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950"
                          : "border-zinc-300 text-zinc-500 hover:bg-black/5 dark:hover:bg-white/10"
                      }`}
                    >
                      {p.trackInventory ? "Tracked" : "Made to order"}
                    </button>
                  </TD>
                  <TD>
                    {p.trackInventory && p.stockQuantity !== null ? (
                      <span
                        className={
                          lowStock
                            ? "inline-block rounded-full px-2.5 py-0.5 text-xs font-medium bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200"
                            : ""
                        }
                      >
                        {p.stockQuantity}
                        {lowStock ? " — low stock" : ""}
                      </span>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TD>
                  <TD>
                    {p.trackInventory && selectedOutletId && (
                      <div className="flex gap-1.5">
                        <input
                          type="number"
                          placeholder="±qty"
                          className="w-20 border rounded px-2 py-1 text-xs dark:bg-zinc-900 transition-colors focus:border-black/40 dark:focus:border-white/40 outline-none"
                          value={deltas[p.id] ?? ""}
                          onChange={(e) =>
                            setDeltas((d) => ({ ...d, [p.id]: e.target.value }))
                          }
                        />
                        <Button variant="secondary" size="sm" onClick={() => handleAdjust(p.id)}>
                          Apply
                        </Button>
                      </div>
                    )}
                  </TD>
                  <TD>
                    <Link
                      href={`/inventory/${p.id}/edit`}
                      className="text-xs underline decoration-transparent hover:decoration-current transition-colors"
                    >
                      Edit
                    </Link>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>
    </div>
  );
}
