"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Search } from "lucide-react";
import { listExternalDeliveryReport, listOutlets } from "@/lib/api";
import type { ExternalDeliveryRow, Outlet, ReportsFilters } from "@/lib/types";
import { useShopMode } from "@/lib/useShopMode";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem } from "@/components/ui/CardList";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import OrderDetailModal from "@/components/OrderDetailModal";
import SimpleOrderDetailModal from "@/components/SimpleOrderDetailModal";
import PageShell from "@/components/ui/PageShell";
import { formatMoney } from "@/lib/money";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

// Orders-tab counterpart of Reports > External Delivery
// (app/reports/external-delivery/page.tsx) — same data source
// (GET /reports/external-delivery, now reachable by branch/order_manager
// too, see that route's own comment), but a narrower column set (Order
// Ref/Customer/Courier/Status/Dispatched At/Price, per the feature spec)
// and clicking a row opens the standard order detail view, which the
// Reports version doesn't do.
export default function ExternalDeliveryOrdersTabPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [rows, setRows] = useState<ExternalDeliveryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [selectedOrderId, setSelectedOrderId] = useState<number | null>(null);
  const mode = useShopMode();
  const isSimple = mode === "simple";

  useEffect(() => {
    listOutlets().then(setOutlets).catch(() => setOutlets([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, appliedFilters]);

  // `latest` drops a response a newer refresh has superseded; a failure ends in
  // an error with Try again.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listExternalDeliveryReport(appliedFilters, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
      })
      .then((result) => {
        if (mine !== latest.current) return;
        setRows(result.data);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load external deliveries");
      });
  }, [appliedFilters, page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <h1 className="text-2xl font-semibold mb-1">External Delivery</h1>
      <OrdersTabs />

      <div className="mb-4">
        <ReportsFilterBar
          value={draftFilters}
          onChange={setDraftFilters}
          outlets={outlets}
          onApply={() => setAppliedFilters(draftFilters)}
        />
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <div className="flex items-center justify-end mb-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute start-2.5 top-1/2 -translate-y-1/2 size-4 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="w-full h-9 rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 ps-8 pe-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      {rows !== null && rows.length > 0 && (
        <CardList>
          {rows.map((row) => (
            <CardListItem
              key={row.id}
              onOpen={() => setSelectedOrderId(row.orderId)}
              openLabel={`Open order #${row.orderId}`}
              actions={<StatusBadge status={row.status} />}
            >
              <div className="truncate text-sm font-semibold text-text-primary dark:text-zinc-100">
                #{row.orderId} {row.customerName}
              </div>
              <div className="truncate text-xs text-text-muted">
                {row.carrier}
                {row.driverName ? ` · ${row.driverName}` : ""}
              </div>
              <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13.5px]">
                <span className="font-bold text-text-primary dark:text-zinc-100">{formatMoney(row.price, row.currency)}</span>
                <span className="text-xs text-text-muted">{new Date(row.createdAt).toLocaleString()}</span>
                {row.trackingUrl && (
                  <a
                    href={row.trackingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="relative z-10 text-xs text-accent-text hover:underline dark:text-accent"
                  >
                    Track
                  </a>
                )}
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table stickyFirst className={rows !== null && rows.length > 0 ? "hidden md:block" : ""}>
        <THead>
          <tr>
            <TH>Order Ref</TH>
            <TH>Customer</TH>
            <TH>Courier/Provider</TH>
            <TH>Driver</TH>
            <TH>Status</TH>
            <TH>Dispatched At</TH>
            <TH>Price</TH>
          </tr>
        </THead>
        <TBody>
          {rows === null ? (
            error ? (
              <tr>
                <td colSpan={7}>
                  <LoadFailed what="external deliveries" onRetry={refresh} />
                </td>
              </tr>
            ) : (
              <tr>
                <td colSpan={7}>
                  <TableSkeleton rows={8} cols={7} />
                </td>
              </tr>
            )
          ) : rows.length === 0 && !error ? (
            <tr>
              <td colSpan={7}>
                <EmptyState
                  title={search ? "No matching deliveries" : "No external deliveries yet"}
                  description={
                    search
                      ? "Try a different search term."
                      : "Log a courier handoff, or send one to Slider, from an order's detail view. It'll show up here."
                  }
                />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <TR
                key={row.id}
                className="cursor-pointer"
                onClick={() => setSelectedOrderId(row.orderId)}
              >
                <TD className="font-medium">#{row.orderId}</TD>
                <TD>
                  <span>{row.customerName}</span>
                  <div className="text-xs text-text-muted">{row.customerPhone}</div>
                </TD>
                <TD>
                  <span>{row.carrier}</span>
                  {row.trackingUrl && (
                    <a
                      href={row.trackingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="block text-xs text-accent-text dark:text-accent hover:underline"
                    >
                      Track
                    </a>
                  )}
                </TD>
                <TD className="text-text-muted">{row.driverName ?? "—"}</TD>
                <TD>
                  <StatusBadge status={row.status} />
                </TD>
                <TD className="text-xs text-text-muted">{new Date(row.createdAt).toLocaleString()}</TD>
                <TD>{formatMoney(row.price, row.currency)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {rows !== null && rows.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-text-muted">
          <span>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
          </span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}

      {isSimple ? (
        <SimpleOrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onChanged={refresh}
        />
      ) : (
        <OrderDetailModal
          orderId={selectedOrderId}
          onClose={() => setSelectedOrderId(null)}
          onChanged={refresh}
        />
      )}
    </PageShell>
  );
}
