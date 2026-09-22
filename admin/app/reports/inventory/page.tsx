"use client";

import { useCallback, useEffect, useState } from "react";
import { getInventoryMovement } from "@/lib/api";
import type { InventoryMovementReport, InventoryMovementRow } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import Select from "@/components/ui/Select";

const WINDOWS = [7, 14, 30, 60, 90];
const DEAD_STOCK_WINDOWS = [14, 30, 60, 90];

function percent(value: number | null) {
  return value === null ? "-" : `${value.toFixed(1)}%`;
}

function cover(value: number | null) {
  if (value === null) return "-";
  return `${value.toFixed(1)} days`;
}

function stock(value: number | null) {
  // Null is "not stocked here", which is not the same as zero. Showing 0 would
  // put a recipe-backed product into a stockout report it has no business in.
  return value === null ? "-" : String(value);
}

export default function InventoryReportPage() {
  const { selectedOutletId } = useOutletFilter();
  const [days, setDays] = useState(30);
  const [deadStockDays, setDeadStockDays] = useState(30);
  const [report, setReport] = useState<InventoryMovementReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setReport(
        await getInventoryMovement({
          days,
          deadStockDays,
          outletId: selectedOutletId ?? undefined,
        }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load inventory report");
    }
  }, [days, deadStockDays, selectedOutletId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const rows: InventoryMovementRow[] | null = report?.rows ?? null;

  return (
    <PageShell variant="wide">
      <Card className="mb-4">
        <h3 className="text-sm font-semibold mb-1">How this is calculated</h3>
        <p className="text-xs text-text-faint">
          Units sold come from the nightly rollup, so they cover complete days only. Stock on hand is
          live, read at the moment this page loaded. Sell-through is units sold divided by units sold
          plus stock on hand. Days of cover is stock on hand divided by the average daily units over
          the window, and is blank when nothing sold, since cover with no sales is not zero but
          unbounded.
          {report?.rolledUpThrough
            ? ` Sales are rolled up through ${report.rolledUpThrough}.`
            : " No days have been rolled up yet, so every sales figure here is zero until the nightly job has run."}
        </p>
      </Card>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="flex items-center gap-2 text-xs text-text-faint">
          Window
          <div className="w-28">
            <Select value={String(days)} onChange={(e) => setDays(Number(e.target.value))}>
              {WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </div>
        </label>
        <label className="flex items-center gap-2 text-xs text-text-faint">
          Dead stock after
          <div className="w-28">
            <Select
              value={String(deadStockDays)}
              onChange={(e) => setDeadStockDays(Number(e.target.value))}
            >
              {DEAD_STOCK_WINDOWS.map((d) => (
                <option key={d} value={d}>
                  {d} days
                </option>
              ))}
            </Select>
          </div>
        </label>
      </div>

      {report && report.deadStock.length > 0 && (
        <Card className="mb-4">
          <h3 className="text-sm font-semibold mb-2">
            Dead stock: {report.deadStock.length} product
            {report.deadStock.length === 1 ? "" : "s"}
          </h3>
          <p className="text-xs text-text-faint mb-3">
            Still in stock, with no sales in the last {report.deadStockAfterDays} days. Products with
            nothing on hand are left out, since there is no capital tied up in them.
          </p>
          <div className="flex flex-wrap gap-2">
            {report.deadStock.map((r) => (
              <span
                key={r.productId}
                className="rounded-full border border-border dark:border-white/15 px-3 py-1 text-xs text-text-secondary dark:text-zinc-400"
              >
                {r.name}
                <span className="ml-1.5 font-semibold text-text-primary dark:text-zinc-100">
                  {stock(r.stockOnHand)} left
                </span>
              </span>
            ))}
          </div>
        </Card>
      )}

      <Table>
        <THead>
          <tr>
            <TH>Product</TH>
            <TH>Units sold</TH>
            <TH>Stock on hand</TH>
            <TH>Sell-through</TH>
            <TH>Days of cover</TH>
            <TH>Last sold</TH>
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
                  title="No products yet"
                  description="Add a product and this report fills in once the nightly rollup has run."
                />
              </td>
            </tr>
          ) : (
            rows.map((r) => (
              <TR key={r.productId}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">
                  {r.name}
                  {r.isDeadStock && (
                    <span className="ml-2 rounded-full bg-amber-100 dark:bg-amber-900/40 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                      Dead stock
                    </span>
                  )}
                </TD>
                <TD className="text-[13.5px]">{r.unitsSold}</TD>
                <TD className="text-[13.5px]">{stock(r.stockOnHand)}</TD>
                <TD className="text-[13.5px]">{percent(r.sellThroughPercent)}</TD>
                <TD className="text-[13.5px]">{cover(r.daysOfCover)}</TD>
                <TD className="text-[13.5px] text-text-muted">
                  {r.daysSinceLastSale === null
                    ? "Never"
                    : r.daysSinceLastSale === 0
                      ? "Today"
                      : `${r.daysSinceLastSale} days ago`}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
