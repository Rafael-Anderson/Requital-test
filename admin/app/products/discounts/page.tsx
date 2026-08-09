"use client";

import { useCallback, useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { deleteDiscount, listCollections, listDiscounts, listProducts, updateDiscount } from "@/lib/api";
import { DISCOUNT_TYPE_LABELS, type Collection, type Discount, type Product } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import BackButton from "@/components/ui/BackButton";
import { useToast } from "@/components/ui/Toast";
import { useUndoableDelete } from "@/lib/useUndoableDelete";
import DiscountFormModal from "@/components/DiscountFormModal";
import ProductsTabs from "@/components/ProductsTabs";
import PageShell from "@/components/ui/PageShell";

function formatValidity(from: string | null, until: string | null): string {
  if (!from && !until) return "Always";
  const f = from ? new Date(from).toLocaleDateString() : "…";
  const u = until ? new Date(until).toLocaleDateString() : "…";
  return `${f} – ${u}`;
}

export default function DiscountsPage() {
  const toast = useToast();
  const deleteWithUndo = useUndoableDelete();
  const [discounts, setDiscounts] = useState<Discount[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Discount | null | "new">(null);

  const refresh = useCallback(async () => {
    try {
      const [discountList, productList, collectionList] = await Promise.all([
        listDiscounts(),
        listProducts(),
        listCollections(),
      ]);
      setDiscounts(discountList);
      setProducts(productList);
      setCollections(collectionList);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load discounts");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleToggleActive(discount: Discount) {
    try {
      await updateDiscount(discount.id, { active: !discount.active });
      toast(discount.active ? `"${discount.code}" deactivated` : `"${discount.code}" activated`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update discount", "error");
    }
  }

  function handleDelete(discount: Discount) {
    deleteWithUndo({
      id: discount.id,
      label: `"${discount.code}"`,
      onRemoveLocally: () => setDiscounts((prev) => (prev ? prev.filter((d) => d.id !== discount.id) : prev)),
      onRestoreLocally: refresh,
      commit: () => deleteDiscount(discount.id),
    });
  }

  return (
    <PageShell>
      <BackButton href="/products" />
      <ProductsTabs />
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Discounts</h1>
        <Button variant="primary" onClick={() => setEditing("new")}>
          <Plus className="size-4 inline -mt-0.5 mr-1" />
          New discount
        </Button>
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Code</TH>
            <TH>Type</TH>
            <TH>Value</TH>
            <TH>Usage</TH>
            <TH>Validity</TH>
            <TH className="w-20">Active</TH>
            <TH className="w-10"></TH>
            <TH className="w-10"></TH>
          </tr>
        </THead>
        <TBody>
          {discounts === null ? (
            <tr>
              <td colSpan={8}>
                <TableSkeleton rows={6} cols={8} />
              </td>
            </tr>
          ) : discounts.length === 0 && !error ? (
            <tr>
              <td colSpan={8}>
                <EmptyState title="No discounts yet" description="Create a promo code to get started." />
              </td>
            </tr>
          ) : (
            discounts.map((d) => (
              <TR key={d.id}>
                <TD className="font-medium">{d.code}</TD>
                <TD>{DISCOUNT_TYPE_LABELS[d.type]}</TD>
                <TD className="text-zinc-500">
                  {d.type === "FREE_SHIPPING" ? "—" : d.type === "PERCENTAGE" ? `${d.value}%` : d.value}
                </TD>
                <TD className="text-zinc-500">
                  {d.timesUsed}
                  {d.usageLimit !== null ? ` / ${d.usageLimit}` : ""}
                </TD>
                <TD className="text-xs text-zinc-500">{formatValidity(d.startsAt, d.endsAt)}</TD>
                <TD>
                  <button
                    onClick={() => handleToggleActive(d)}
                    className={`text-xs rounded px-2 py-1 border transition-colors cursor-pointer ${
                      d.active
                        ? "border-green-400 text-green-700 dark:text-green-400 hover:bg-green-50 dark:hover:bg-green-950"
                        : "border-red-300 text-red-600 dark:border-red-800 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                    }`}
                  >
                    {d.active ? "Active" : "Inactive"}
                  </button>
                </TD>
                <TD>
                  <button
                    onClick={() => setEditing(d)}
                    className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                    aria-label={`Edit ${d.code}`}
                  >
                    <Pencil className="size-4" />
                  </button>
                </TD>
                <TD>
                  <button
                    onClick={() => handleDelete(d)}
                    className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer"
                    aria-label={`Delete ${d.code}`}
                  >
                    <Trash2 className="size-4" />
                  </button>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {editing && (
        <DiscountFormModal
          discount={editing === "new" ? null : editing}
          products={products}
          collections={collections}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
