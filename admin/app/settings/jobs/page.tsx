"use client";

import { useCallback, useEffect, useState } from "react";
import { listFailedJobs, retryFailedJob, dismissFailedJob } from "@/lib/api";
import type { FailedJob } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";
import Tooltip from "@/components/ui/Tooltip";
import { RotateCcw, X } from "lucide-react";

// Minimal ops visibility for the Phase 5 job queue — lists only dead-letter
// (permanently failed, exhausted-retries) jobs. Pending/processing/completed
// jobs aren't shown here; this view exists so an admin can see what's
// actually broken and either retry or dismiss it, not to be a general job
// dashboard.
export default function FailedJobsPage() {
  const toast = useToast();
  const [jobs, setJobs] = useState<FailedJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const result = await listFailedJobs();
      setJobs(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load failed jobs");
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleRetry(job: FailedJob) {
    setBusyId(job.id);
    try {
      await retryFailedJob(job.id);
      setJobs((prev) => prev?.filter((j) => j.id !== job.id) ?? prev);
      toast(`Job #${job.id} queued for retry`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Retry failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDismiss(job: FailedJob) {
    setBusyId(job.id);
    try {
      await dismissFailedJob(job.id);
      setJobs((prev) => prev?.filter((j) => j.id !== job.id) ?? prev);
      toast(`Job #${job.id} dismissed`, "success");
    } catch (err) {
      toast(err instanceof Error ? err.message : "Dismiss failed", "error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <PageShell>
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <h1 className="text-2xl font-semibold">Failed Jobs</h1>
      </div>
      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Type</TH>
            <TH>Error</TH>
            <TH className="w-24">Attempts</TH>
            <TH className="w-40">Failed At</TH>
            <TH className="w-20">Retry</TH>
            <TH className="w-20">Dismiss</TH>
          </tr>
        </THead>
        <TBody>
          {jobs === null ? (
            <tr>
              <td colSpan={6}>
                <TableSkeleton rows={6} cols={6} />
              </td>
            </tr>
          ) : jobs.length === 0 && !error ? (
            <tr>
              <td colSpan={6}>
                <EmptyState title="Nothing broken" description="Failed jobs (after retries are exhausted) will show up here." />
              </td>
            </tr>
          ) : (
            jobs.map((j) => (
              <TR key={j.id}>
                <TD className="font-medium">{j.type}</TD>
                <TD className="text-xs text-zinc-500 max-w-md truncate" title={j.lastError ?? ""}>
                  {j.lastError ?? "-"}
                </TD>
                <TD className="text-zinc-500">
                  {j.attempts}/{j.maxAttempts}
                </TD>
                <TD className="text-xs text-zinc-500">{new Date(j.updatedAt).toLocaleString()}</TD>
                <TD>
                  <Tooltip label="Retry this job now">
                    <button
                      onClick={() => handleRetry(j)}
                      disabled={busyId === j.id}
                      className="p-1.5 rounded text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-200 hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Retry job ${j.id}`}
                    >
                      <RotateCcw className="size-4" />
                    </button>
                  </Tooltip>
                </TD>
                <TD>
                  <Tooltip label="Dismiss without retrying. This cannot be undone." align="end">
                    <button
                      onClick={() => handleDismiss(j)}
                      disabled={busyId === j.id}
                      className="p-1.5 rounded text-zinc-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-950 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                      aria-label={`Dismiss job ${j.id}`}
                    >
                      <X className="size-4" />
                    </button>
                  </Tooltip>
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
