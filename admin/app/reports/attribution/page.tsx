"use client";

import { useEffect, useState } from "react";
import { Calendar, Download } from "lucide-react";
import { downloadExport, getAttributionReport, listOutlets } from "@/lib/api";
import type { AttributionModel, AttributionReport, Outlet, ReportsFilters } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import Button from "@/components/ui/Button";
import Combobox from "@/components/ui/Combobox";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";
import { reportsFilterInputClass } from "@/components/ReportsFilterBar";
import { formatMoney } from "@/lib/money";

const MODELS: { value: AttributionModel; label: string }[] = [
  { value: "last", label: "Last touch" },
  { value: "first", label: "First touch" },
];

// Orders and revenue by where they came from (MKT-14). Each row is one source /
// medium / campaign in ONE currency, rendered in that row's own currency: a shop
// can hold orders in several over its life and they are never summed together.
export default function AttributionReportPage() {
  const toast = useToast();
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draft, setDraft] = useState<ReportsFilters>({});
  const [applied, setApplied] = useState<ReportsFilters>({});
  const [model, setModel] = useState<AttributionModel>("last");
  const [report, setReport] = useState<AttributionReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    listOutlets()
      .then(setOutlets)
      .catch(() => setOutlets([]));
  }, []);

  // The `.then` callback form, not a refresh() closure called from the effect:
  // same behaviour, and it does not trip react-hooks/set-state-in-effect.
  useEffect(() => {
    let cancelled = false;
    getAttributionReport(applied, model)
      .then((r) => {
        if (cancelled) return;
        setReport(r);
        setError(null);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load attribution report");
      });
    return () => {
      cancelled = true;
    };
  }, [applied, model]);

  async function handleExport() {
    setExporting(true);
    try {
      await downloadExport("attribution", {
        dateFrom: applied.dateFrom,
        dateTo: applied.dateTo,
        outletId: applied.outletId,
        model,
      });
      toast("Export started");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Failed to export", "error");
    } finally {
      setExporting(false);
    }
  }

  return (
    <PageShell>
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-1.5">
          <Calendar className="size-4 text-text-faint shrink-0" />
          <input
            type="date"
            value={draft.dateFrom ?? ""}
            max={draft.dateTo}
            onChange={(e) => setDraft({ ...draft, dateFrom: e.target.value || undefined })}
            className={reportsFilterInputClass}
          />
          <span className="text-text-faint text-[12.5px]">to</span>
          <input
            type="date"
            value={draft.dateTo ?? ""}
            min={draft.dateFrom}
            onChange={(e) => setDraft({ ...draft, dateTo: e.target.value || undefined })}
            className={reportsFilterInputClass}
          />
        </div>
        <div className="w-40">
          <Combobox
            value={draft.outletId !== undefined ? String(draft.outletId) : ""}
            onChange={(v) => setDraft({ ...draft, outletId: v ? Number(v) : undefined })}
            placeholder="Select outlet"
            options={outlets.map((o) => ({ value: String(o.id), label: o.name }))}
          />
        </div>
        <Button variant="primary" size="sm" onClick={() => setApplied(draft)}>
          Apply
        </Button>
        <div className="ms-auto">
          <Button variant="secondary" size="sm" onClick={handleExport} disabled={exporting} loading={exporting}>
            <Download className="size-4" />
            Export CSV
          </Button>
        </div>
      </div>

      {error && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      <Card className="mb-4">
        <h3 className="text-sm font-semibold mb-1">How this is calculated</h3>
        <p className="text-xs text-text-faint">
          Orders are grouped by where the shopper came from, taken from the link they arrived on (UTM
          parameters) or the site that referred them. Last touch credits the visit just before the order,
          first touch credits the visit that first brought them in. Cancelled orders and online payment
          orders that were never paid are left out. Orders with no recorded source, such as those placed
          before this report existed or entered by staff, appear as unknown. Revenue is in each order&apos;s
          own currency.
        </p>
      </Card>

      <div className="flex items-center gap-2 mb-3">
        <span className="text-xs text-text-faint">Credit</span>
        {MODELS.map((m) => (
          <button
            key={m.value}
            type="button"
            onClick={() => setModel(m.value)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              model === m.value
                ? "bg-accent text-white"
                : "border border-border dark:border-white/15 text-text-secondary dark:text-zinc-400 hover:bg-surface-muted"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <Table stickyFirst>
        <THead>
          <tr>
            <TH>Source</TH>
            <TH>Medium</TH>
            <TH>Campaign</TH>
            <TH>Orders</TH>
            <TH>Revenue</TH>
          </tr>
        </THead>
        <TBody>
          {report === null ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={8} cols={5} />
              </td>
            </tr>
          ) : report.rows.length === 0 && !error ? (
            <tr>
              <td colSpan={5}>
                <EmptyState
                  title="Nothing in this range"
                  description="No orders match the current filters."
                />
              </td>
            </tr>
          ) : (
            report.rows.map((r) => (
              <TR key={`${r.source}|${r.medium}|${r.campaign}|${r.currency}`}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">{r.source}</TD>
                <TD className="text-[13.5px]">{r.medium}</TD>
                <TD className="text-[13.5px]">{r.campaign}</TD>
                <TD className="text-[13.5px]">{r.orders}</TD>
                <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">
                  {formatMoney(r.revenue, r.currency)}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
      {report?.truncated && (
        <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
          Showing the top {report.rows.length} rows. Export the CSV for everything.
        </p>
      )}
    </PageShell>
  );
}
