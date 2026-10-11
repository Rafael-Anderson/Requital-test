"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { ArrowDown, ArrowUp, Copy, Printer, X } from "lucide-react";
import {
  cancelDeliveryRun,
  dispatchDeliveryRun,
  getDeliveryRun,
  getRunSheetHtml,
  issueRunLink,
  removeRunStop,
  reorderRunStops,
  resolveImageUrl,
  revokeRunLink,
  sendRunLinkWhatsApp,
} from "@/lib/api";
import {
  PROOF_REQUIREMENT_LABELS,
  RUN_STATUS_LABELS,
  type DeliveryRunDetail,
  type DeliveryRunStop,
} from "@/lib/types";
import { formatMoney } from "@/lib/money";
import Button from "@/components/ui/Button";
import Card from "@/components/ui/Card";
import LoadFailed from "@/components/ui/LoadFailed";
import BackButton from "@/components/ui/BackButton";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import PageShell from "@/components/ui/PageShell";
import { useToast } from "@/components/ui/Toast";

const STOP_LABEL: Record<DeliveryRunStop["status"], string> = {
  pending: "Pending",
  delivered: "Delivered",
  failed: "Failed",
};

const FAILURE_LABEL: Record<string, string> = {
  run_cancelled: "Run cancelled",
  order_changed: "Order changed before dispatch",
  order_not_deliverable: "Order no longer deliverable",
  order_cancelled: "Order was cancelled",
};

export default function DeliveryRunDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const toast = useToast();
  const [run, setRun] = useState<DeliveryRunDetail | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The secret link is shown once (after dispatch / re-issue) and lives only in
  // this component's memory: the server keeps just a hash, so it cannot be re-read.
  const [shownLink, setShownLink] = useState<{ url: string; expiresAt: string } | null>(null);

  const latest = useRef(0);
  const refresh = useCallback(() => {
    const mine = ++latest.current;
    getDeliveryRun(id)
      .then((r) => {
        if (mine !== latest.current) return;
        setRun(r);
        setLoadFailed(false);
      })
      .catch(() => {
        if (mine === latest.current) setLoadFailed(true);
      });
  }, [id]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // A live run changes under us (the driver is working it): poll, like Live Orders.
  const live = run?.status === "dispatched" || run?.status === "in_progress";
  useEffect(() => {
    if (!live) return;
    const t = setInterval(refresh, 20000);
    return () => clearInterval(t);
  }, [live, refresh]);

  async function act(fn: () => Promise<DeliveryRunDetail | void>, okMessage?: string) {
    setBusy(true);
    setActionError(null);
    try {
      const result = await fn();
      if (result) setRun(result);
      if (okMessage) toast(okMessage);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, delta: -1 | 1) {
    if (!run) return;
    const ids = run.stops.map((s) => s.id);
    const target = index + delta;
    if (target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void act(() => reorderRunStops(id, ids));
  }

  async function dispatch() {
    await act(async () => {
      const result = await dispatchDeliveryRun(id);
      if (result.issuedLink) setShownLink(result.issuedLink);
      return result;
    }, "Run dispatched");
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast("Link copied");
    } catch {
      toast("Could not copy, select the link and copy it by hand", "error");
    }
  }

  async function printSheet() {
    try {
      const html = await getRunSheetHtml(id);
      const w = window.open("", "_blank");
      if (!w) {
        toast("Allow pop-ups to print the run sheet", "error");
        return;
      }
      w.document.open();
      w.document.write(html);
      w.document.close();
      w.focus();
      w.print();
    } catch {
      toast("Could not open the run sheet", "error");
    }
  }

  if (loadFailed && !run) {
    return (
      <PageShell>
        <BackButton href="/orders/runs" />
        <LoadFailed what="this run" onRetry={refresh} />
      </PageShell>
    );
  }
  if (!run) {
    return (
      <PageShell>
        <BackButton href="/orders/runs" />
        <p className="mt-4 text-sm text-text-muted">Loading...</p>
      </PageShell>
    );
  }

  const editable = run.status === "draft" || run.status === "dispatched" || run.status === "in_progress";
  const hasLiveLink = run.link !== null || shownLink !== null;

  return (
    <PageShell>
      <BackButton href="/orders/runs" />
      <div className="mb-4 mt-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Run #{run.id}</h1>
          <p className="text-sm text-text-muted">
            {run.driver?.name} ({run.driver?.phone}) &middot; {RUN_STATUS_LABELS[run.status]} &middot;{" "}
            {PROOF_REQUIREMENT_LABELS[run.proofRequirement]}
            {run.runDate && <> &middot; {run.runDate}</>}
          </p>
          {run.notes && <p className="text-sm text-text-muted">Notes: {run.notes}</p>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => void printSheet()}>
            <Printer className="-mt-0.5 me-1 inline size-4" />
            Run sheet
          </Button>
          {run.status === "draft" && (
            <Button variant="primary" loading={busy} disabled={busy || run.stops.length === 0} onClick={() => void dispatch()}>
              Dispatch
            </Button>
          )}
          {editable && (
            <Button
              variant="danger"
              disabled={busy}
              onClick={() => {
                if (window.confirm("Cancel this run? Pending stops are released and the driver's link stops working.")) {
                  void act(() => cancelDeliveryRun(id), "Run cancelled");
                }
              }}
            >
              Cancel run
            </Button>
          )}
        </div>
      </div>

      {actionError && <InlineErrorMessage className="mb-3">{actionError}</InlineErrorMessage>}

      {live && (
        <Card className="mb-4 space-y-2 p-4">
          <h2 className="text-base font-semibold">Driver link</h2>
          {shownLink ? (
            <div className="space-y-2">
              <p className="text-sm text-text-muted">
                Send this link to the driver. It works without a password and stops working at{" "}
                {new Date(shownLink.expiresAt).toLocaleString()}, or as soon as you revoke it. It will not be shown again.
              </p>
              <div className="flex items-center gap-2">
                <input readOnly aria-label="Driver link" value={shownLink.url} className="min-w-0 flex-1 rounded-lg border border-border bg-page px-3 py-2 text-xs dark:border-white/15 dark:bg-transparent" onFocus={(e) => e.currentTarget.select()} />
                <Button size="sm" variant="secondary" onClick={() => void copy(shownLink.url)}>
                  <Copy className="-mt-0.5 me-1 inline size-4" />
                  Copy
                </Button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-text-muted">
              {run.link
                ? `A link is active until ${new Date(run.link.expiresAt).toLocaleString()}${run.link.lastUsedAt ? ` (last opened ${new Date(run.link.lastUsedAt).toLocaleTimeString()})` : " (not opened yet)"}. The link itself cannot be shown again; create a new one to replace it.`
                : "There is no active link."}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  setShownLink(await issueRunLink(id));
                  refresh();
                }, "New link created. The old one no longer works.")
              }
            >
              {hasLiveLink ? "Create a new link" : "Create link"}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const sent = await sendRunLinkWhatsApp(id);
                  setShownLink({ url: sent.url, expiresAt: sent.expiresAt });
                  refresh();
                }, "Sent to the driver on WhatsApp")
              }
            >
              Send on WhatsApp
            </Button>
            {hasLiveLink && (
              <Button
                size="sm"
                variant="danger"
                disabled={busy}
                onClick={() =>
                  void act(async () => {
                    await revokeRunLink(id);
                    setShownLink(null);
                    refresh();
                  }, "Link revoked")
                }
              >
                Revoke link
              </Button>
            )}
          </div>
        </Card>
      )}

      {run.cash.length > 0 && (
        <Card className="mb-4 p-4">
          <h2 className="mb-2 text-base font-semibold">Cash on delivery</h2>
          <ul className="space-y-1 text-sm">
            {run.cash.map((c) => (
              <li key={c.currency} className="flex flex-wrap gap-x-4">
                <span>Expected {formatMoney(c.expected, c.currency)}</span>
                <span>Collected {formatMoney(c.collected, c.currency)}</span>
                <span className={c.discrepancies > 0 ? "font-medium text-red-600 dark:text-red-400" : "text-text-muted"}>
                  Difference {formatMoney(c.difference, c.currency)}
                  {c.discrepancies > 0 && ` (${c.discrepancies} mismatch${c.discrepancies === 1 ? "" : "es"})`}
                </span>
                {Number(c.pending) > 0 && <span className="text-text-muted">Still to collect {formatMoney(c.pending, c.currency)}</span>}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <ol className="space-y-2">
        {run.stops.map((s, i) => (
          <li key={s.id} className="rounded-xl border border-border bg-surface p-3 dark:border-white/10 dark:bg-zinc-900">
            <div className="flex items-start gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-white">{s.position}</span>
              <div className="min-w-0 flex-1 text-sm">
                <div className="flex flex-wrap items-center gap-x-2">
                  <span className="font-semibold">
                    #{s.order.shopOrderNumber} {s.order.customerName}
                  </span>
                  <span
                    className={`text-xs font-medium ${s.status === "delivered" ? "text-green-600 dark:text-green-400" : s.status === "failed" ? "text-red-600 dark:text-red-400" : "text-text-muted"}`}
                  >
                    {STOP_LABEL[s.status]}
                  </span>
                </div>
                <div className="text-xs text-text-muted">
                  {[s.order.customerAddress, s.order.area, s.order.regionName].filter(Boolean).join(", ")} &middot; {s.order.customerPhone}
                </div>
                {s.order.deliveryNotes && <div className="text-xs text-text-muted">Notes: {s.order.deliveryNotes}</div>}
                {s.status === "failed" && s.failureReason && (
                  <div className="text-xs text-red-600 dark:text-red-400">{FAILURE_LABEL[s.failureReason] ?? s.failureReason}</div>
                )}
                {s.cod && (
                  <div className="text-xs">
                    Cash on delivery {formatMoney(s.codExpected ?? s.order.total, s.cashCurrency ?? s.order.currency)}
                    {s.status === "delivered" && s.cashCollectedAmount && (
                      <span className={s.cashDiscrepancy ? "ms-2 font-medium text-red-600 dark:text-red-400" : "ms-2 text-green-600 dark:text-green-400"}>
                        collected {formatMoney(s.cashCollectedAmount, s.cashCurrency ?? s.order.currency)}
                        {s.cashDiscrepancy && " (does not match)"}
                      </span>
                    )}
                  </div>
                )}
                {s.status === "delivered" && s.proofType && (
                  <div className="text-xs text-text-muted">
                    Proof: {s.proofType}
                    {s.proofPhotoUrl && (
                      <>
                        {" "}
                        &middot;{" "}
                        <a href={resolveImageUrl(s.proofPhotoUrl) ?? undefined} target="_blank" rel="noopener noreferrer" className="text-accent-text underline">
                          View photo
                        </a>
                      </>
                    )}
                  </div>
                )}
              </div>
              {editable && s.status === "pending" && (
                <div className="flex shrink-0 items-center">
                  <button type="button" aria-label="Move up" disabled={busy || i === 0} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => move(i, -1)}>
                    <ArrowUp className="size-4" />
                  </button>
                  <button type="button" aria-label="Move down" disabled={busy || i === run.stops.length - 1} className="rounded p-1.5 hover:bg-black/5 disabled:opacity-30 dark:hover:bg-white/10" onClick={() => move(i, 1)}>
                    <ArrowDown className="size-4" />
                  </button>
                  <button
                    type="button"
                    aria-label={`Remove order ${s.order.shopOrderNumber} from the run`}
                    disabled={busy}
                    className="rounded p-1.5 hover:bg-black/5 dark:hover:bg-white/10"
                    onClick={() => void act(() => removeRunStop(id, s.id), "Stop removed")}
                  >
                    <X className="size-4" />
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ol>
    </PageShell>
  );
}
