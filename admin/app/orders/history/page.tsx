"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { bulkUpdateOrderStatus, listOrders } from "@/lib/api";
import { ORDER_STATUSES, type Order, type OrderStatus } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { useRowSelection } from "@/lib/useRowSelection";
import { downloadCsv } from "@/lib/csv";
import StatusBadge from "@/components/StatusBadge";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import Checkbox from "@/components/ui/Checkbox";
import BulkActionBar from "@/components/ui/BulkActionBar";
import { useToast } from "@/components/ui/Toast";
import BackButton from "@/components/ui/BackButton";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import OrderDetailModal from "@/components/OrderDetailModal";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function OrderHistoryPage() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const { selectedOutletId } = useOutletFilter();
  const toast = useToast();
  const visibleIds = useMemo(() => (orders ?? []).map((o) => o.id), [orders]);
  const selection = useRowSelection(visibleIds);
  const [bulkStatus, setBulkStatus] = useState<OrderStatus | "">("");
  const [bulkBusy, setBulkBusy] = useState(false);

  // Debounce: wait for typing to pause before it becomes the actual query.
  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // Any new search term or outlet switch restarts from page 1 — a stale page
  // number from a previous, larger result set could be past the end of this one.
  useEffect(() => {
    setPage(1);
  }, [search, selectedOutletId]);

  const refresh = useCallback(async () => {
    try {
      // Order History is the full record — every status, live or terminal,
      // shows here (the kanban board is the active-work view; they overlap
      // by design). No `statuses` filter is passed, so the backend applies
      // none and returns everything for this shop (within the selected outlet).
      const result = await listOrders({
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        outletId: selectedOutletId ?? undefined,
      });
      setOrders(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load orders");
    }
  }, [page, search, selectedOutletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  async function handleBulkStatus() {
    if (!bulkStatus) {
      toast("Pick a status", "error");
      return;
    }
    setBulkBusy(true);
    try {
      const { succeeded, results } = await bulkUpdateOrderStatus(selection.selectedIds, bulkStatus);
      const failed = results.filter((r) => !r.success);
      if (failed.length > 0) {
        toast(`Updated ${succeeded}, ${failed.length} couldn't make that transition`, "error");
      } else {
        toast(`Updated ${succeeded} order${succeeded === 1 ? "" : "s"}`);
      }
      setBulkStatus("");
      selection.clear();
      refresh();
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to update orders", "error");
    } finally {
      setBulkBusy(false);
    }
  }

  function handleBulkExport() {
    const rows = (orders ?? []).filter((o) => selection.selected.has(o.id));
    downloadCsv(
      `orders-${new Date().toISOString().slice(0, 10)}.csv`,
      ["Ref No", "Status", "Customer", "Type", "Payment Status", "Total", "Channel", "Placed At"],
      rows.map((o) => [
        o.id,
        o.status,
        o.customerName,
        o.orderType ?? "",
        o.paymentStatus,
        o.total,
        o.channel ?? "",
        new Date(o.createdAt).toLocaleString(),
      ]),
    );
    toast(`Exported ${rows.length} order${rows.length === 1 ? "" : "s"}`);
  }

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Orders</h1>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search ref no, customer, or phone…"
            className="w-full h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>
      <OrdersTabs />

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <BulkActionBar count={selection.selectedIds.length} onClear={selection.clear}>
        <select
          value={bulkStatus}
          onChange={(e) => setBulkStatus(e.target.value as OrderStatus | "")}
          className="border border-black/15 dark:border-white/15 rounded px-2 py-1.5 text-sm dark:bg-zinc-900 cursor-pointer"
        >
          <option value="">Move to…</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <Button size="sm" variant="secondary" onClick={handleBulkStatus} disabled={bulkBusy}>
          Apply
        </Button>
        <Button size="sm" variant="secondary" onClick={handleBulkExport} disabled={bulkBusy}>
          Export CSV
        </Button>
      </BulkActionBar>

      <Table>
        <THead>
          <tr>
            <TH className="w-8">
              <Checkbox
                checked={selection.allSelected}
                onChange={selection.toggleAll}
                aria-label="Select all orders"
              />
            </TH>
            <TH>Ref No</TH>
            <TH>Status</TH>
            <TH>Customer Name</TH>
            <TH>Type</TH>
            <TH>Payment Mode</TH>
            <TH>Grand Total</TH>
            <TH>Channel</TH>
            <TH>Placed At</TH>
            <TH></TH>
          </tr>
        </THead>
        <TBody>
          {orders === null ? (
            <tr>
              <td colSpan={10}>
                <TableSkeleton rows={8} cols={10} />
              </td>
            </tr>
          ) : orders.length === 0 && !error ? (
            <tr>
              <td colSpan={10}>
                <EmptyState
                  title={search ? "No matching orders" : "No orders yet"}
                  description={
                    search
                      ? "Try a different ref no, name, or phone number."
                      : "Orders will show up here once placed."
                  }
                />
              </td>
            </tr>
          ) : (
            orders.map((order) => {
              const latestTxn = order.paymenttransaction?.[0];
              return (
                <TR key={order.id}>
                  <TD>
                    <Checkbox
                      checked={selection.selected.has(order.id)}
                      onChange={() => selection.toggle(order.id)}
                      aria-label={`Select order #${order.id}`}
                    />
                  </TD>
                  <TD className="font-medium">#{order.id}</TD>
                  <TD>
                    <StatusBadge status={order.status} />
                  </TD>
                  <TD>{order.customerName}</TD>
                  <TD className="capitalize text-zinc-500">{order.orderType ?? "-"}</TD>
                  <TD>
                    <StatusBadge status={order.paymentStatus} />
                    {latestTxn && (
                      <div className="text-xs text-zinc-500 mt-1 capitalize">
                        via {latestTxn.gateway}
                      </div>
                    )}
                  </TD>
                  <TD>{order.total} AED</TD>
                  <TD className="text-zinc-500">{order.channel ?? "-"}</TD>
                  <TD className="text-xs text-zinc-500">
                    {new Date(order.createdAt).toLocaleString()}
                  </TD>
                  <TD>
                    <Button size="sm" variant="secondary" onClick={() => setSelectedOrderId(order.id)}>
                      View
                    </Button>
                  </TD>
                </TR>
              );
            })
          )}
        </TBody>
      </Table>

      {orders !== null && orders.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-zinc-500">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              variant="secondary"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      <OrderDetailModal
        orderId={selectedOrderId}
        onClose={() => setSelectedOrderId(null)}
        onChanged={refresh}
      />
    </PageShell>
  );
}
