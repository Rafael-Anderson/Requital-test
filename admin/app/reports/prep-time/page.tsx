"use client";

import { useCallback, useEffect, useState } from "react";
import { getPrepTimeReport, listOutlets } from "@/lib/api";
import type { Outlet, PrepTimeBucket, PrepTimeReport, ReportsFilters } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import Card from "@/components/ui/Card";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import ReportsFilterBar from "@/components/ReportsFilterBar";
import PageShell from "@/components/ui/PageShell";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// How far the measured median sits from the configured constant. Colour is
// the only signal here: this page reports, it never edits the setting.
function deltaTone(deltaMinutes: number): string {
  if (deltaMinutes > 10) return "text-sale-price";
  if (deltaMinutes < -10) return "text-emerald-600";
  return "text-text-muted";
}

function formatDelta(deltaMinutes: number): string {
  const rounded = Math.round(deltaMinutes * 10) / 10;
  if (rounded === 0) return "on target";
  return rounded > 0 ? `+${rounded} min over` : `${Math.abs(rounded)} min under`;
}

export default function PrepTimeReportPage() {
  const [outlets, setOutlets] = useState<Outlet[]>([]);
  const [draftFilters, setDraftFilters] = useState<ReportsFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<ReportsFilters>({});
  const [report, setReport] = useState<PrepTimeReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listOutlets()
      .then(setOutlets)
      .catch(() => setOutlets([]));
  }, []);

  const refresh = useCallback(async () => {
    try {
      setReport(await getPrepTimeReport(appliedFilters));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report");
    }
  }, [appliedFilters]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Pickup orders are measured against the pickup constant, everything else
  // against the delivery one. With no orderType filter the mix is ambiguous,
  // so the delivery constant is used and the note below says so.
  const configured =
    appliedFilters.orderType === "pickup"
      ? report?.configured.pickupPreparationTimeMinutes
      : report?.configured.deliveryPreparationTimeMinutes;

  const buckets: PrepTimeBucket[] | null = report?.buckets ?? null;
  const unmeasured = report ? report.ordersConsidered - report.ordersMeasured : 0;

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
        <h3 className="text-sm font-semibold mb-1">What this measures</h3>
        <p className="text-xs text-text-faint">
          The real time between an order being confirmed and leaving the shop, taken from the
          recorded status changes. Your configured preparation time is a setting nobody measures
          against, so this is the comparison, nothing more. Changing the setting is still up to you,
          under Settings, Outlets, Delivery.
        </p>
        {report && (
          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              Configured:{" "}
              <strong className="text-text-primary dark:text-zinc-100">
                {configured ?? 0} min
              </strong>
              {appliedFilters.orderType !== "pickup" && (
                <span className="text-text-faint"> (delivery)</span>
              )}
            </span>
            <span className="text-text-muted">
              Measured on {report.ordersMeasured} of {report.ordersConsidered} orders
            </span>
            <span className="text-xs text-text-faint">Day of week in {report.timezone}</span>
          </div>
        )}
        {unmeasured > 0 && (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            {unmeasured} order{unmeasured === 1 ? "" : "s"} in this range could not be measured. An
            order only counts once both its confirmed and out for delivery transitions were recorded
            by staff, so orders still in progress, or advanced automatically by a courier or payment
            webhook, are not included.
          </p>
        )}
      </Card>

      <Table>
        <THead>
          <tr>
            <TH>Outlet</TH>
            <TH>Day</TH>
            <TH>Orders</TH>
            <TH>Median</TH>
            <TH>Average</TH>
            <TH>Slowest 10%</TH>
            <TH>Hands on</TH>
            <TH>vs configured</TH>
          </tr>
        </THead>
        <TBody>
          {buckets === null ? (
            <tr>
              <td colSpan={8}>
                <TableSkeleton rows={7} cols={8} />
              </td>
            </tr>
          ) : buckets.length === 0 && !error ? (
            <tr>
              <td colSpan={8}>
                <EmptyState
                  title="Nothing measured yet"
                  description="No order in this range has both a confirmed and an out for delivery status change recorded. Try a wider date range."
                />
              </td>
            </tr>
          ) : (
            buckets.map((b) => (
              <TR key={`${b.outletId}-${b.dayOfWeek}`}>
                <TD className="text-sm font-semibold text-text-primary dark:text-zinc-100">
                  {b.outletName}
                </TD>
                <TD className="text-[13.5px]">{DAY_NAMES[b.dayOfWeek]}</TD>
                <TD className="text-[13.5px]">{b.orderCount}</TD>
                <TD className="text-[13.5px] font-semibold text-text-primary dark:text-zinc-100">
                  {b.medianMinutes} min
                </TD>
                <TD className="text-[13.5px]">{b.averageMinutes} min</TD>
                <TD className="text-[13.5px]">{b.p90Minutes} min</TD>
                <TD className="text-[13.5px] text-text-muted">
                  {b.handsOnMedianMinutes === null ? "-" : `${b.handsOnMedianMinutes} min`}
                </TD>
                <TD className={`text-[13.5px] font-medium ${deltaTone(b.medianMinutes - (configured ?? 0))}`}>
                  {formatDelta(b.medianMinutes - (configured ?? 0))}
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
