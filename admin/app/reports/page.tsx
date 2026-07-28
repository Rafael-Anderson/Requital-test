"use client";

import { useCallback, useEffect, useState } from "react";
import { getGeneralReportSummary, listGeneralReportOrders, listOutlets } from "@/lib/api";
import type { GeneralReportOrderRow, GeneralReportSummary, Outlet, ReportsFilters } from "@/lib/types";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import GeneralReportView from "@/components/GeneralReportView";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

export default function GeneralReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [summary, setSummary] = useState<GeneralReportSummary | null>(null);
  const [orders, setOrders] = useState<GeneralReportOrderRow[] | null>(null);
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
      const [summaryResult, ordersResult] = await Promise.all([
        getGeneralReportSummary(appliedFilters),
        listGeneralReportOrders(appliedFilters, { page, pageSize: PAGE_SIZE, search: search || undefined }),
      ]);
      setSummary(summaryResult);
      setOrders(ordersResult.data);
      setTotal(ordersResult.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, [appliedFilters, page, search]);

  useEffect(() => {
    refresh();
  }, [refresh]);

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

      <GeneralReportView
        summary={summary}
        orders={orders}
        error={error}
        searchInput={searchInput}
        onSearchInputChange={setSearchInput}
        search={search}
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        onPrevPage={() => setPage((p) => p - 1)}
        onNextPage={() => setPage((p) => p + 1)}
      />
    </PageShell>
  );
}
