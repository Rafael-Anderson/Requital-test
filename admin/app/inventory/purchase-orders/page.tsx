"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { listPurchaseOrders } from "@/lib/api";
import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderListItem, type PurchaseOrderStatus } from "@/lib/types";
import { useAuth } from "@/lib/auth-context";
import { useOutletFilter } from "@/lib/outlet-context";
import { formatMoney } from "@/lib/money";
import BackButton from "@/components/ui/BackButton";
import Button from "@/components/ui/Button";
import EmptyState from "@/components/ui/EmptyState";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import Select from "@/components/ui/Select";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem } from "@/components/ui/CardList";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import BranchBar from "@/components/BranchBar";
import InventoryTabs from "@/components/InventoryTabs";
import PurchaseOrderStatusBadge from "@/components/PurchaseOrderStatusBadge";

const PAGE_SIZE = 20;

export default function PurchaseOrdersPage() {
  const { user } = useAuth();
  const { selectedOutletId } = useOutletFilter();
  const [rows, setRows] = useState<PurchaseOrderListItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [status, setStatus] = useState<PurchaseOrderStatus | "">("");
  const [error, setError] = useState<string | null>(null);

  // Try again bumps `reloadKey`; the fetch itself runs in promise callbacks.
  const [reloadKey, setReloadKey] = useState(0);
  const refresh = useCallback(() => {
    setError(null);
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    let live = true;
    listPurchaseOrders({ page, pageSize: PAGE_SIZE, status: status || undefined, outletId: selectedOutletId ?? undefined })
      .then((res) => {
        if (!live) return;
        setRows(res.data);
        setTotal(res.total);
        setError(null);
      })
      .catch((err) => {
        if (live) setError(err instanceof Error ? err.message : "Failed to load purchase orders");
      });
    return () => {
      live = false;
    };
  }, [page, status, selectedOutletId, reloadKey]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const canCreate = user?.role === "admin" || user?.role === "branch";

  return (
    <PageShell variant="wide">
      <BranchBar left={<BackButton href="/inventory" />} />
      <InventoryTabs />

      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-[-0.015em] text-text-primary dark:text-zinc-50">Purchase Orders</h1>
        <div className="flex items-center gap-3">
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value as PurchaseOrderStatus | "");
              setPage(1);
            }}
          >
            <option value="">All statuses</option>
            {(Object.keys(PURCHASE_ORDER_STATUS_LABELS) as PurchaseOrderStatus[]).map((s) => (
              <option key={s} value={s}>
                {PURCHASE_ORDER_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
          {canCreate && (
            <Link href="/inventory/purchase-orders/new">
              <Button variant="primary">
                <Plus className="-mt-0.5 me-1 inline size-4" />
                New purchase order
              </Button>
            </Link>
          )}
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {rows === null ? (
        error ? <LoadFailed what="purchase orders" onRetry={refresh} /> : <TableSkeleton rows={5} cols={6} />
      ) : rows.length === 0 ? (
        <EmptyState title="No purchase orders yet" description="Raise one to order stock from a supplier, then receive it into an outlet's stock when it arrives." />
      ) : (
        <>
        {/* Below md one tappable card per purchase order; md and up the table. */}
        <CardList>
          {rows.map((po) => (
            <CardListItem
              key={po.id}
              href={`/inventory/purchase-orders/${po.id}`}
              openLabel={`Open ${po.poNumber}`}
              actions={<PurchaseOrderStatusBadge status={po.status} />}
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">{po.poNumber}</div>
              <div className="truncate text-xs text-text-muted">
                {po.supplierName} · {po.outletName}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                <span className="font-bold text-text-primary dark:text-zinc-100">{formatMoney(po.total, po.currency)}</span>
                <span className="text-text-muted">
                  {po.unitsReceived} / {po.unitsOrdered} received
                </span>
                <span className="text-xs text-text-faint">{po.expectedAt ? `Expected ${po.expectedAt}` : "No expected date"}</span>
              </div>
            </CardListItem>
          ))}
        </CardList>
        <Table stickyFirst className="hidden md:block">
          <THead>
            <TR>
              <TH className="text-start">Number</TH>
              <TH className="text-start">Supplier</TH>
              <TH className="text-start">Receiving outlet</TH>
              <TH className="text-start">Status</TH>
              <TH className="text-end">Received</TH>
              <TH className="text-end">Total</TH>
              <TH className="text-start">Expected</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((po) => (
              <TR key={po.id}>
                <TD>
                  <Link href={`/inventory/purchase-orders/${po.id}`} className="font-semibold text-text-primary hover:text-accent-text dark:text-zinc-100">
                    {po.poNumber}
                  </Link>
                </TD>
                <TD>{po.supplierName}</TD>
                <TD>{po.outletName}</TD>
                <TD>
                  <PurchaseOrderStatusBadge status={po.status} />
                </TD>
                <TD className="text-end">
                  {po.unitsReceived} / {po.unitsOrdered}
                </TD>
                <TD className="text-end">{formatMoney(po.total, po.currency)}</TD>
                <TD>{po.expectedAt ?? <span className="text-text-muted">Not set</span>}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
        </>
      )}

      {totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm">
          <Button variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <span className="text-text-muted">
            Page {page} of {totalPages}
          </span>
          <Button variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      )}
    </PageShell>
  );
}
