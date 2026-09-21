"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { getMarginBreakdown, getMarginSummary, listOutlets } from "@/lib/api";
import type {
  MarginDimension,
  MarginRow,
  MarginSummary,
  Outlet,
  ReportsFilters,
} from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import PageShell from "@/components/ui/PageShell";

const DIMENSIONS: { value: MarginDimension; label: string }[] = [
  { value: "product", label: "Product" },
  { value: "collection", label: "Collection" },
  { value: "channel", label: "Channel" },
  { value: "outlet", label: "Outlet" },
  { value: "order", label: "Order" },
];

function money(value: number) {
  return `${value.toFixed(2)} AED`;
}

function percent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

export default function MarginReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [dimension, setDimension] = useState<MarginDimension>("product");
  const [summary, setSummary] = useState<MarginSummary | null>(null);
  const [rows, setRows] = useState<MarginRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listOutlets()
      .then(setOutlets)
      .catch(() => setOutlets([]));
  }, []);

  const refresh = useCallback(async () => {
    try {
      const [nextSummary, nextRows] = await Promise.all([
        getMarginSummary(appliedFilters),
        getMarginBreakdown(appliedFilters, dimension),
      ]);
      setSummary(nextSummary);
      setRows(nextRows);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load margin report");
    }
  }, [appliedFilters, dimension]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Nothing costed at all is the expected first experience: cost price is
  // optional and most catalogues have never had it filled in. Say that
  // plainly and point at the fix, rather than rendering a table of zeroes
  // that looks like a measurement.
  const nothingCosted = summary !== null && summary.linesCosted === 0;

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

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <Card className="mb-4">
        <h3 className="text-sm font-semibold mb-1">How this is calculated</h3>
        <p className="text-xs text-text-faint">
          Margin uses the cost recorded on each order line at the moment it was placed, not
          today&apos;s cost price. Editing a product&apos;s cost changes future orders only, so a
          past report never moves. Orders placed before 21 September 2026 have no recorded cost and
          cannot be included, since there is no way to know what they actually cost at the time.
        </p>
      </Card>

      {summary && !nothingCosted && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
          <Card>
            <p className="text-xs text-text-faint">Revenue (costed lines)</p>
            <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
              {money(summary.revenue)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-text-faint">Cost</p>
            <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
              {money(summary.cost)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-text-faint">Gross margin</p>
            <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
              {money(summary.margin)}
            </p>
          </Card>
          <Card>
            <p className="text-xs text-text-faint">Margin %</p>
            <p className="text-lg font-bold text-text-primary dark:text-zinc-50">
              {percent(summary.marginPercent)}
            </p>
          </Card>
        </div>
      )}

      {summary && summary.linesWithoutCost > 0 && !nothingCosted && (
        <p className="mb-4 text-xs text-amber-600 dark:text-amber-400">
          {summary.linesWithoutCost} order line{summary.linesWithoutCost === 1 ? "" : "s"} in this
          range {summary.linesWithoutCost === 1 ? "has" : "have"} no recorded cost and{" "}
          {summary.linesWithoutCost === 1 ? "is" : "are"} left out of these totals. That is either
          an order placed before cost recording started, or a product with no cost price set.
        </p>
      )}

      {nothingCosted ? (
        <EmptyState
          title="No costs recorded yet"
          description="Margin needs a cost price on your products. Set one on a product, and every order placed after that records what it cost at the time. Orders placed before then cannot be included."
        />
      ) : (
        <>
          <div className="flex items-center gap-2 mb-3">
            <span className="text-xs text-text-faint">Group by</span>
            {DIMENSIONS.map((d) => (
              <button
                key={d.value}
                type="button"
                onClick={() => setDimension(d.value)}
                className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  dimension === d.value
                    ? "bg-accent text-white"
                    : "border border-border dark:border-white/15 text-text-secondary dark:text-zinc-400 hover:bg-surface-muted"
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>

          <Table>
            <THead>
              <tr>
                <TH>{DIMENSIONS.find((d) => d.value === dimension)?.label}</TH>
                <TH>Revenue</TH>
                <TH>Cost</TH>
                <TH>Margin</TH>
                <TH>Margin %</TH>
                <TH>Uncosted lines</TH>
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
                      title="Nothing in this range"
                      description="No order lines match the current filters."
                    />
                  </td>
                </tr>
              ) : (
                rows.map((r) => (
                  <TR key={`${dimension}-${r.key ?? r.label}`}>
                    <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">
                      {dimension === "order" ? (
                        <Link href={`/orders/${r.key}`} className="hover:underline">
                          #{r.label}
                        </Link>
                      ) : (
                        r.label
                      )}
                    </TD>
                    <TD className="text-[13.5px]">{money(r.revenue)}</TD>
                    <TD className="text-[13.5px]">{money(r.cost)}</TD>
                    <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">
                      {money(r.margin)}
                    </TD>
                    <TD className="text-[13.5px]">{percent(r.marginPercent)}</TD>
                    <TD className="text-[13.5px] text-text-muted">
                      {r.linesWithoutCost === 0 ? "-" : r.linesWithoutCost}
                    </TD>
                  </TR>
                ))
              )}
            </TBody>
          </Table>
        </>
      )}
    </PageShell>
  );
}
