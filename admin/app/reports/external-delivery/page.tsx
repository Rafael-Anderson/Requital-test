"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { listExternalDeliveryReport, listOutlets } from "@/lib/api";
import type { ExternalDeliveryRow, Outlet, ReportsFilters } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import StatusBadge from "@/components/StatusBadge";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

// No stat cards, unlike General/Monthly Report — matches the reference
// layout, which shows this as a plain filtered table (order + courier
// details). See backend externaldelivery model comment: this is a manual
// merchant log ("we sent this order via Careem, paid X") — no real courier
// API integration exists.
export default function ExternalDeliveryReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [rows, setRows] = useState<ExternalDeliveryRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);

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

  const refresh = useCallback(async () => {
    try {
      const result = await listExternalDeliveryReport(appliedFilters, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
      });
      setRows(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, [appliedFilters, page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <PageShell>
      <div className="mb-4">
        <ReportsFilterBar
          value={draftFilters}
          onChange={setDraftFilters}
          outlets={outlets}
          onApply={() => setAppliedFilters(draftFilters)}
        />
      </div>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <div className="flex items-center justify-end mb-3">
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-text-faint" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="w-full h-9 rounded-lg border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>Order Reference No</TH>
            <TH>Outlet</TH>
            <TH>Customer</TH>
            <TH>Carrier</TH>
            <TH>Vehicle Type</TH>
            <TH>Destination</TH>
            <TH>Price</TH>
            <TH>Status</TH>
            <TH>Logged At</TH>
          </tr>
        </THead>
        <TBody>
          {rows === null ? (
            <tr>
              <td colSpan={9}>
                <TableSkeleton rows={8} cols={9} />
              </td>
            </tr>
          ) : rows.length === 0 && !error ? (
            <tr>
              <td colSpan={9}>
                <EmptyState
                  title={search ? "No matching deliveries" : "No external deliveries logged yet"}
                  description={
                    search
                      ? "Try a different search term."
                      : "Log a courier handoff from an order's detail view. It'll show up here."
                  }
                />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <TR key={row.id}>
                <TD className="font-medium">#{row.orderId}</TD>
                <TD className="text-text-muted">{row.outletName}</TD>
                <TD>
                  <span>{row.customerName}</span>
                  <div className="text-xs text-text-muted">{row.customerPhone}</div>
                </TD>
                <TD>{row.carrier}</TD>
                <TD className="text-text-muted">{row.vehicleType ?? "-"}</TD>
                <TD className="text-text-muted">{row.destination}</TD>
                <TD>{Number(row.price).toFixed(2)} AED</TD>
                <TD>
                  <StatusBadge status={row.status} />
                </TD>
                <TD className="text-xs text-text-muted">{new Date(row.createdAt).toLocaleString()}</TD>
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
    </PageShell>
  );
}
