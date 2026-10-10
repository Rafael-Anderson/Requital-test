"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import { listDeliveryRuns } from "@/lib/api";
import { RUN_STATUS_LABELS, type DeliveryRunListItem, type DeliveryRunStatus } from "@/lib/types";
import { useOutletFilter } from "@/lib/outlet-context";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import LoadFailed from "@/components/ui/LoadFailed";
import { CardList, CardListItem, CardListSkeleton } from "@/components/ui/CardList";
import Button from "@/components/ui/Button";
import Select from "@/components/ui/Select";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import BranchBar from "@/components/BranchBar";
import OrdersTabs from "@/components/OrdersTabs";
import PageShell from "@/components/ui/PageShell";

const STATUS_CLASS: Record<DeliveryRunStatus, string> = {
  draft: "text-text-secondary dark:text-zinc-400",
  dispatched: "text-amber-600 dark:text-amber-400",
  in_progress: "text-amber-600 dark:text-amber-400",
  completed: "text-green-600 dark:text-green-400",
  cancelled: "text-red-600 dark:text-red-400",
};

export default function DeliveryRunsPage() {
  const { selectedOutletId } = useOutletFilter();
  const [status, setStatus] = useState<DeliveryRunStatus | "">("");
  const [runs, setRuns] = useState<DeliveryRunListItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // `latest` drops a response a newer request has superseded; a failure ends in
  // LoadFailed with Try again instead of a permanent skeleton.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    listDeliveryRuns({ outletId: selectedOutletId, status: status || undefined })
      .then((result) => {
        if (mine !== latest.current) return;
        setRuns(result.data);
        setError(null);
      })
      .catch((err) => {
        if (mine !== latest.current) return;
        setError(err instanceof Error ? err.message : "Failed to load delivery runs");
      });
  }, [selectedOutletId, status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const placeholder =
    runs === null && error ? (
      <LoadFailed what="delivery runs" onRetry={refresh} />
    ) : runs !== null && runs.length === 0 && !error ? (
      <EmptyState title="No delivery runs yet" description="Group ready orders into a run and send it to one of your drivers." />
    ) : null;

  return (
    <PageShell>
      <BranchBar left={<BackButton href="/orders" />} />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">Delivery Runs</h1>
        <div className="flex gap-2">
          <Link href="/orders/drivers">
            <Button variant="secondary">
              <Users className="-mt-0.5 me-1 inline size-4" />
              Drivers
            </Button>
          </Link>
          <Link href="/orders/runs/new">
            <Button variant="primary">
              <Plus className="-mt-0.5 me-1 inline size-4" />
              New run
            </Button>
          </Link>
        </div>
      </div>
      <OrdersTabs />
      <div className="mb-3 max-w-xs">
        <Select
          label="Status"
          value={status}
          onChange={(e) => {
            setRuns(null);
            setStatus(e.target.value as DeliveryRunStatus | "");
          }}
        >
          <option value="">All</option>
          {(Object.keys(RUN_STATUS_LABELS) as DeliveryRunStatus[]).map((s) => (
            <option key={s} value={s}>
              {RUN_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
      </div>

      {error && runs !== null && <InlineErrorMessage className="mb-3">{error}</InlineErrorMessage>}

      {runs === null && !error ? (
        <CardListSkeleton rows={4} selectable={false} />
      ) : placeholder ? (
        <div className="rounded-2xl border border-border bg-surface md:hidden dark:border-white/10 dark:bg-zinc-900">{placeholder}</div>
      ) : (
        <CardList>
          {(runs ?? []).map((r) => (
            <CardListItem
              key={r.id}
              href={`/orders/runs/${r.id}`}
              openLabel={`Open run ${r.id} for ${r.driverName}`}
              actions={<span className={`text-xs font-medium ${STATUS_CLASS[r.status]}`}>{RUN_STATUS_LABELS[r.status]}</span>}
            >
              <div className="truncate text-sm font-semibold">Run #{r.id}</div>
              <div className="truncate text-xs text-text-muted">{r.driverName}</div>
              <div className="mt-0.5 text-[13px] text-text-muted">
                {r.deliveredCount}/{r.stopCount} delivered
                {r.failedCount > 0 && `, ${r.failedCount} failed`}
                {r.discrepancyCount > 0 && `, ${r.discrepancyCount} cash mismatch`}
              </div>
            </CardListItem>
          ))}
        </CardList>
      )}

      <Table className="hidden md:block">
        <THead>
          <tr>
            <TH className="w-20">Run</TH>
            <TH>Driver</TH>
            <TH className="w-28">Status</TH>
            <TH>Progress</TH>
            <TH className="w-32">Date</TH>
          </tr>
        </THead>
        <TBody>
          {runs === null && !error ? (
            <tr>
              <td colSpan={5}>
                <TableSkeleton rows={5} cols={5} />
              </td>
            </tr>
          ) : placeholder ? (
            <tr>
              <td colSpan={5}>{placeholder}</td>
            </tr>
          ) : (
            (runs ?? []).map((r) => (
              <TR key={r.id}>
                <TD>
                  <Link href={`/orders/runs/${r.id}`} className="font-medium hover:underline">
                    #{r.id}
                  </Link>
                </TD>
                <TD>{r.driverName}</TD>
                <TD className={`font-medium ${STATUS_CLASS[r.status]}`}>{RUN_STATUS_LABELS[r.status]}</TD>
                <TD className="text-text-muted">
                  {r.deliveredCount}/{r.stopCount} delivered
                  {r.failedCount > 0 && `, ${r.failedCount} failed`}
                  {r.discrepancyCount > 0 && (
                    <span className="ms-2 font-medium text-red-600 dark:text-red-400">{r.discrepancyCount} cash mismatch</span>
                  )}
                </TD>
                <TD className="text-xs text-text-muted">{r.runDate ?? new Date(r.createdAt).toLocaleDateString()}</TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
