"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Pencil, Plus } from "lucide-react";
import { createReorderDrafts, listReorderLowStock, listReorderSuggestions } from "@/lib/api";
import type { ReorderLowStockRow, ReorderNoSupplierReason, ReorderSuggestions } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";
import { formatMoney } from "@/lib/money";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import ScrollFade from "@/components/ui/ScrollFade";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem } from "@/components/ui/CardList";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import Tooltip from "@/components/ui/Tooltip";
import { useToast } from "@/components/ui/Toast";
import BranchBar from "@/components/BranchBar";
import InventoryTabs from "@/components/InventoryTabs";
import ReorderPointModal, { type ReorderPointTarget } from "@/components/ReorderPointModal";

const NO_SUPPLIER_TEXT: Record<ReorderNoSupplierReason, string> = {
  no_supplier: "No supplier sells this item yet",
  unpriced_supplier_item: "A supplier lists it without a price and currency",
  no_reorder_quantity: "No reorder quantity set",
};

export default function ReorderPage() {
  const { user } = useAuth();
  const { selectedOutletId, outlets } = useOutletFilter();
  const toast = useToast();
  const isAdmin = user?.role === "admin";
  const canDraft = user?.role === "admin" || user?.role === "branch";
  const [low, setLow] = useState<ReorderLowStockRow[] | null>(null);
  const [lowError, setLowError] = useState<string | null>(null);
  const [sugg, setSugg] = useState<ReorderSuggestions | null>(null);
  const [suggError, setSuggError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [editing, setEditing] = useState<ReorderPointTarget | "new" | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const refresh = useCallback(() => {
    setLowError(null);
    setSuggError(null);
    setReloadKey((k) => k + 1);
  }, []);

  // Two independent chains: the suggestions render even when the low-stock list fails.
  useEffect(() => {
    let live = true;
    listReorderLowStock(selectedOutletId ?? undefined)
      .then((res) => {
        if (!live) return;
        setLow(res.data);
        setLowError(null);
      })
      .catch((err) => {
        if (live) setLowError(err instanceof Error ? err.message : "Failed to load low stock");
      });
    return () => {
      live = false;
    };
  }, [selectedOutletId, reloadKey]);

  useEffect(() => {
    let live = true;
    listReorderSuggestions(selectedOutletId ?? undefined)
      .then((res) => {
        if (!live) return;
        setSugg(res);
        setSuggError(null);
      })
      .catch((err) => {
        if (live) setSuggError(err instanceof Error ? err.message : "Failed to load suggestions");
      });
    return () => {
      live = false;
    };
  }, [selectedOutletId, reloadKey]);

  async function createDrafts(outletId: number, supplierId?: number) {
    setBusy(`${outletId}:${supplierId ?? "all"}`);
    try {
      const res = await createReorderDrafts({ outletId, ...(supplierId ? { supplierId } : {}) });
      toast(res.created.length === 0 ? "Nothing left to order" : `${res.created.length} draft purchase order${res.created.length === 1 ? "" : "s"} created`);
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to create drafts", "error");
    } finally {
      setBusy(null);
    }
  }

  const outletName = (id: number) => outlets.find((o) => o.id === id)?.name ?? `Branch ${id}`;
  const showOutlet = selectedOutletId === null;
  const rowTarget = (r: ReorderLowStockRow): ReorderPointTarget => ({
    ingredientId: r.ingredientId,
    name: r.name,
    outletId: r.outletId,
    reorderPoint: r.reorderPoint,
    reorderQuantity: r.reorderQuantity,
  });

  return (
    <PageShell variant="wide">
      <BranchBar left={<BackButton href="/inventory" />} />
      <InventoryTabs />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Reorder</h1>
        {isAdmin && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            <Plus className="-mt-0.5 me-1 inline size-4" />
            Set a reorder point
          </Button>
        )}
      </div>

      <div className="space-y-5">
        <Card>
          <h2 className="mb-1 text-base font-bold text-text-primary dark:text-zinc-50">Low stock</h2>
          <p className="mb-3 text-sm text-text-muted">Items at or below their reorder point. Stock already on open purchase orders is shown beside the count.</p>
          {lowError && low !== null && <InlineErrorMessage className="mb-3">{lowError}</InlineErrorMessage>}
          {low === null ? (
            lowError ? <LoadFailed what="low stock" onRetry={refresh} /> : <TableSkeleton rows={3} cols={5} />
          ) : low.length === 0 ? (
            <EmptyState title="Nothing is below its reorder point" description="Set a reorder point on an item and it will appear here when stock falls to it." />
          ) : (
            <>
              <CardList>
                {low.map((r) => (
                  <CardListItem
                    key={`${r.outletId}-${r.ingredientId}`}
                    onOpen={isAdmin ? () => setEditing(rowTarget(r)) : undefined}
                    openLabel={`Edit reorder point for ${r.name}`}
                  >
                    <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{r.name}</div>
                    {showOutlet && <div className="truncate text-xs text-text-muted">{r.outletName}</div>}
                    <div className="mt-0.5 flex flex-wrap gap-x-3 text-[13.5px]">
                      <span>{r.stock} in stock</span>
                      <span className="text-text-muted">{r.onOrder} on order</span>
                      <span className="text-text-muted">point {r.reorderPoint}</span>
                      {r.covered && <span className="font-semibold text-accent-text">Covered</span>}
                    </div>
                  </CardListItem>
                ))}
              </CardList>
              <Table stickyFirst className="hidden md:block">
                <THead>
                  <TR>
                    <TH className="text-start">Item</TH>
                    {showOutlet && <TH className="text-start">Branch</TH>}
                    <TH className="text-end">In stock</TH>
                    <TH className="text-end">On order</TH>
                    <TH className="text-end">Reorder point</TH>
                    <TH className="text-end">Order quantity</TH>
                    <TH className="text-start">Status</TH>
                    {isAdmin && <TH className="text-end">
                      <span className="sr-only">Actions</span>
                    </TH>}
                  </TR>
                </THead>
                <TBody>
                  {low.map((r) => (
                    <TR key={`${r.outletId}-${r.ingredientId}`}>
                      <TD className="font-semibold">{r.name}</TD>
                      {showOutlet && <TD>{r.outletName}</TD>}
                      <TD className="text-end">{r.stock}</TD>
                      <TD className="text-end">{r.onOrder}</TD>
                      <TD className="text-end">{r.reorderPoint}</TD>
                      <TD className="text-end">{r.reorderQuantity ?? <span className="text-text-muted">Not set</span>}</TD>
                      <TD>{r.covered ? <span className="font-semibold text-accent-text">Covered by open orders</span> : <span className="text-text-secondary">Needs ordering</span>}</TD>
                      {isAdmin && (
                        <TD className="text-end">
                          <Tooltip label="Edit reorder point">
                            <button
                              type="button"
                              aria-label={`Edit reorder point for ${r.name}`}
                              className="cursor-pointer rounded p-1.5 text-zinc-500 transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
                              onClick={() => setEditing(rowTarget(r))}
                            >
                              <Pencil className="size-4" />
                            </button>
                          </Tooltip>
                        </TD>
                      )}
                    </TR>
                  ))}
                </TBody>
              </Table>
            </>
          )}
        </Card>

        <Card>
          <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-text-primary dark:text-zinc-50">Suggested purchase orders</h2>
            {canDraft && selectedOutletId !== null && sugg && sugg.groups.length > 0 && (
              <Button variant="primary" disabled={busy !== null} loading={busy === `${selectedOutletId}:all`} onClick={() => createDrafts(selectedOutletId)}>
                Create all as drafts
              </Button>
            )}
          </div>
          <p className="mb-3 text-sm text-text-muted">
            Each item goes to its cheapest supplier in one currency (prices in different currencies are never compared; the shortest lead time wins instead). Drafts are never sent for you, and clicking again creates nothing twice.
          </p>
          {suggError && sugg !== null && <InlineErrorMessage className="mb-3">{suggError}</InlineErrorMessage>}
          {sugg === null ? (
            suggError ? <LoadFailed what="suggested purchase orders" onRetry={refresh} /> : <TableSkeleton rows={3} cols={4} />
          ) : (
            <div className="space-y-4">
              {sugg.groups.length === 0 && sugg.noSupplier.length === 0 && (
                <EmptyState title="Nothing to order" description="No item is at its reorder point without enough on order already." />
              )}
              {sugg.groups.map((g) => (
                <div key={`${g.outletId}-${g.supplierId}-${g.currency}`} className="rounded-xl border border-border p-3 dark:border-white/10">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-bold text-text-primary dark:text-zinc-100">{g.supplierName}</div>
                      <div className="text-xs text-text-muted">
                        {showOutlet ? `${outletName(g.outletId)} · ` : ""}
                        {g.lines.length} item{g.lines.length === 1 ? "" : "s"} · {formatMoney(g.subtotal, g.currency)}
                      </div>
                      {g.belowMinimumOrderAmount && <div className="text-xs text-amber-700 dark:text-amber-400">Below this supplier&apos;s minimum order amount</div>}
                    </div>
                    {canDraft && (
                      <Button size="sm" variant="secondary" disabled={busy !== null} loading={busy === `${g.outletId}:${g.supplierId}`} onClick={() => createDrafts(g.outletId, g.supplierId)}>
                        Create draft
                      </Button>
                    )}
                  </div>
                  <ScrollFade stickyFirst className="mt-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-[11.5px] font-bold uppercase tracking-wide text-text-faint">
                          <th className="p-2 text-start">Item</th>
                          <th className="p-2 text-end">In stock</th>
                          <th className="p-2 text-end">On order</th>
                          <th className="p-2 text-end">Order</th>
                          <th className="p-2 text-end">Unit cost</th>
                          <th className="p-2 text-end">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {g.lines.map((l) => (
                          <tr key={l.ingredientId} className="border-t border-border-light dark:border-white/10">
                            <td className="p-2 font-semibold">{l.name}</td>
                            <td className="p-2 text-end">{l.stock}</td>
                            <td className="p-2 text-end">{l.onOrder}</td>
                            <td className="p-2 text-end">{l.quantity}</td>
                            <td className="p-2 text-end">{formatMoney(l.unitCost, g.currency)}</td>
                            <td className="p-2 text-end">{formatMoney(l.lineTotal, g.currency)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollFade>
                </div>
              ))}
              {sugg.noSupplier.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-bold text-text-primary dark:text-zinc-100">Needs a supplier or a setting first</h3>
                  <ul className="space-y-1 text-sm">
                    {sugg.noSupplier.map((n) => (
                      <li key={`${n.outletId}-${n.ingredientId}`} className="flex flex-wrap gap-x-2">
                        <span className="font-semibold">{n.name}</span>
                        {showOutlet && <span className="text-text-muted">{outletName(n.outletId)}</span>}
                        <span className="text-text-muted">{NO_SUPPLIER_TEXT[n.reason]}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-1 text-xs text-text-muted">
                    Add the item to a supplier under <Link href="/inventory/suppliers" className="underline">Suppliers</Link>.
                  </p>
                </div>
              )}
            </div>
          )}
        </Card>
      </div>

      {editing !== null && (
        <ReorderPointModal
          target={editing === "new" ? null : editing}
          outlets={outlets}
          defaultOutletId={selectedOutletId}
          onClose={() => setEditing(null)}
          onSaved={refresh}
        />
      )}
    </PageShell>
  );
}
