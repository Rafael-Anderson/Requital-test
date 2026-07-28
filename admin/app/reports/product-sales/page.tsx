"use client";

import { useCallback, useEffect, useState } from "react";
import { Search } from "lucide-react";
import { listOutlets, listProductSales, resolveImageUrl } from "@/lib/api";
import type { Outlet, ProductSalesRow, ReportsFilters } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Button from "@/components/ui/Button";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

type SortField = "name" | "currentPrice" | "orderCount" | "totalQuantity" | "totalSalePrice";
const COLUMNS: { field: SortField; label: string }[] = [
  { field: "currentPrice", label: "Current Price" },
  { field: "orderCount", label: "Order Count" },
  { field: "totalQuantity", label: "Total Quantity" },
  { field: "totalSalePrice", label: "Total Sale Price" },
];

export default function ProductSaleReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [rows, setRows] = useState<ProductSalesRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<SortField>("totalSalePrice");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
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
  }, [search, appliedFilters, sortBy, sortDir]);

  const refresh = useCallback(async () => {
    try {
      const result = await listProductSales(appliedFilters, {
        page,
        pageSize: PAGE_SIZE,
        search: search || undefined,
        sortBy,
        sortDir,
      });
      setRows(result.data);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, [appliedFilters, page, search, sortBy, sortDir]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  function toggleSort(field: SortField) {
    if (sortBy === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
  }

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
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-4 text-zinc-400" />
          <input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search…"
            className="w-full h-9 rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 pl-8 pr-3 text-sm shadow-sm shadow-black/5 outline-none transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
          />
        </div>
      </div>

      <Table>
        <THead>
          <tr>
            <TH>
              <button
                type="button"
                onClick={() => toggleSort("name")}
                className="flex items-center gap-1 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200"
              >
                Product
                {sortBy === "name" && <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
              </button>
            </TH>
            {COLUMNS.map(({ field, label }) => (
              <TH key={field}>
                <button
                  type="button"
                  onClick={() => toggleSort(field)}
                  className="flex items-center gap-1 cursor-pointer hover:text-zinc-800 dark:hover:text-zinc-200"
                >
                  {label}
                  {sortBy === field && <span className="text-xs">{sortDir === "asc" ? "▲" : "▼"}</span>}
                </button>
              </TH>
            ))}
            <TH>Delivery Fee</TH>
          </tr>
        </THead>
        <TBody>
          {rows === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={8} cols={6} />
              </td>
            </tr>
          ) : rows.length === 0 && !error ? (
            <tr>
              <td colSpan={6}>
                <EmptyState
                  title={search ? "No matching products" : "No sales yet"}
                  description={search ? "Try a different product name." : "Products with sales matching these filters will show up here."}
                />
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <TR key={row.productId}>
                <TD>
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={resolveImageUrl(row.thumbnail) ?? undefined}
                      alt=""
                      className="size-10 rounded-lg object-cover bg-black/5 dark:bg-white/10 shrink-0"
                    />
                    <span className="font-medium">{row.name}</span>
                  </div>
                </TD>
                <TD>{Number(row.currentPrice).toFixed(2)} AED</TD>
                <TD>{row.orderCount}</TD>
                <TD>{row.totalQuantity}</TD>
                <TD>{row.totalSalePrice.toFixed(2)} AED</TD>
                <TD className="text-zinc-500">{row.deliveryFee.toFixed(2)}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>

      {rows !== null && rows.length > 0 && (
        <div className="flex items-center justify-between mt-3 text-sm text-zinc-500">
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
