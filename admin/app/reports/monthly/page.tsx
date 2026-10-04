"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CalendarDays } from "lucide-react";
import { getMonthlyReportSummary, listMonthlyReportOrders, listOutlets } from "@/lib/api";
import type { GeneralReportOrderRow, GeneralReportSummary, Outlet, ReportsFilters } from "@/lib/types";
import ReportsFilterBar, { reportsFilterInputClass } from "@/components/ReportsFilterBar";
import GeneralReportView from "@/components/GeneralReportView";
import PageShell from "@/components/ui/PageShell";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

// Structurally General Report with `month` swapped in for the date range —
// same stat cards, same order table, same non-date filters (see
// GeneralReportView/ReportsFilterBar). The backend does the actual reuse
// (ReportsService.getMonthlySummary/listMonthlyOrders just translate month
// into the same dateFrom/dateTo General Report already understands); this
// page mirrors that by reusing the exact same view component, not
// rebuilding it.
export default function MonthlyReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [draftMonth, setDraftMonth] = useState(currentMonth());
  const [appliedMonth, setAppliedMonth] = useState(currentMonth());
  const [summary, setSummary] = useState<GeneralReportSummary | null>(null);
  const [orders, setOrders] = useState<GeneralReportOrderRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  useEffect(() => {
    listOutlets().then(setOutlets).catch(() => setOutlets([]));
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [search, appliedFilters, appliedMonth]);

  // The summary cards and the order list load on independent chains: neither
  // waits on, or is lost to, the other. Each ends in an error with Try again,
  // and a `latest` counter drops a response a newer refresh has superseded.
  const latestSummary = useRef(0);
  const refreshSummary = useCallback(() => {
    const mine = ++latestSummary.current;
    getMonthlyReportSummary({ ...appliedFilters, month: appliedMonth })
      .then((result) => {
        if (mine !== latestSummary.current) return;
        setSummary(result);
        setSummaryError(null);
      })
      .catch((err) => {
        if (mine !== latestSummary.current) return;
        setSummaryError(err instanceof Error ? err.message : "Failed to load the summary");
      });
  }, [appliedFilters, appliedMonth]);

  const latestOrders = useRef(0);
  const refreshOrders = useCallback(() => {
    const mine = ++latestOrders.current;
    listMonthlyReportOrders({ ...appliedFilters, month: appliedMonth }, { page, pageSize: PAGE_SIZE, search: search || undefined })
      .then((result) => {
        if (mine !== latestOrders.current) return;
        setOrders(result.data);
        setTotal(result.total);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latestOrders.current) return;
        setError(err instanceof Error ? err.message : "Failed to load report");
      });
  }, [appliedFilters, appliedMonth, page, search]);

  useEffect(() => {
    refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    refreshOrders();
  }, [refreshOrders]);

  return (
    <PageShell>
      <div className="mb-4">
        <ReportsFilterBar
          value={draftFilters}
          onChange={setDraftFilters}
          outlets={outlets}
          onApply={() => {
            setAppliedFilters(draftFilters);
            setAppliedMonth(draftMonth);
          }}
          dateControl={
            <div className="flex items-center gap-1.5">
              <CalendarDays className="size-4 text-text-faint shrink-0" />
              <input
                type="month"
                value={draftMonth}
                onChange={(e) => setDraftMonth(e.target.value)}
                className={reportsFilterInputClass}
              />
            </div>
          }
        />
      </div>

      <GeneralReportView
        summary={summary}
        orders={orders}
        error={error}
        summaryError={summaryError}
        onRetrySummary={refreshSummary}
        onRetryOrders={refreshOrders}
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
