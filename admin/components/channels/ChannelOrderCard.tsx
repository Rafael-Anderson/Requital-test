"use client";

import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import Button from "@/components/ui/Button";
import { ChannelSourceBadge, ChannelStateBadge, AcceptDeadline } from "@/components/channels/ChannelBadges";
import { CHANNEL_STATE_HINTS, externalStatusLabel } from "@/lib/channels";
import { formatMoney } from "@/lib/money";
import { relativeTime } from "@/lib/format";
import type { ChannelOrder } from "@/lib/types";

// One marketplace order on the desk. A waiting order is loud (amber edge, the
// marketplace's deadline, Accept / Reject); the rest are quiet records. The API
// already hides the commission from non-admins, so it is shown whenever it is
// present and never inferred.
export default function ChannelOrderCard({
  order,
  outletName,
  isAdmin,
  busy,
  onAccept,
  onReject,
  onReady,
  onConfirmScheduled,
  capabilities,
  now,
}: {
  order: ChannelOrder;
  outletName?: string;
  isAdmin: boolean;
  busy: boolean;
  onAccept: (o: ChannelOrder) => void;
  onReject: (o: ChannelOrder) => void;
  // Both open a confirm dialog on the page; they are human actions, never automatic.
  onReady?: (o: ChannelOrder) => void;
  onConfirmScheduled?: (o: ChannelOrder) => void;
  // What this order's marketplace can do (from /channels/providers). Unknown
  // (not loaded, or a provider that was removed) offers neither button.
  capabilities?: Record<string, boolean>;
  now?: number;
}) {
  const waiting = order.state === "pending_acceptance";
  const needsMapping = order.state === "needs_mapping";
  const label = order.displayId ?? order.externalOrderId;
  const mismatch = order.priceMismatch?.length ?? 0;
  const accepted = order.state === "accepted";
  const scheduled = order.confirmBy !== null || order.scheduledFor !== null;
  const canConfirm = accepted && scheduled && order.confirmedAt === null && !!capabilities?.scheduledConfirm && !!onConfirmScheduled;
  const canReady = accepted && order.orderId !== null && order.readyAt === null && !!capabilities?.markReady && !!onReady;
  return (
    <article
      aria-label={`${order.provider} order ${label}`}
      className={`rounded-2xl border bg-surface p-4 dark:bg-zinc-900 ${
        waiting
          ? "border-amber-400 shadow-[0_0_0_3px_rgba(245,158,11,0.12)] dark:border-amber-500/60"
          : "border-border dark:border-white/10"
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ChannelSourceBadge channel={order.provider} />
        <span className="text-[14px] font-bold text-text-primary dark:text-zinc-50">#{label}</span>
        <span className="ms-auto">
          <ChannelStateBadge state={order.state} />
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm">
        {order.total !== null && (
          <span className="font-bold text-text-primary dark:text-zinc-50">{formatMoney(order.total, order.currency)}</span>
        )}
        {isAdmin && order.commissionAmount !== null && (
          <span className="text-text-muted">Marketplace commission {formatMoney(order.commissionAmount, order.currency)}</span>
        )}
        {outletName && <span className="text-text-muted">{outletName}</span>}
        <span className="text-text-faint">Received {relativeTime(order.receivedAt)}</span>
      </div>

      {waiting && (
        <div className="mt-3">
          <AcceptDeadline acceptBy={order.acceptBy} now={now} />
        </div>
      )}

      {needsMapping && (
        <div className="mt-3 rounded-xl bg-warning-bg p-3 text-[13px] text-warning-text dark:bg-amber-500/10 dark:text-amber-300">
          <p>{CHANNEL_STATE_HINTS.needs_mapping}</p>
          {order.waitingItems && order.waitingItems.length > 0 && (
            <ul className="mt-2 list-disc ps-5">
              {order.waitingItems.map((i) => (
                <li key={i.externalItemId}>
                  {i.quantity} x {i.name}
                </li>
              ))}
            </ul>
          )}
          {order.acceptBy && (
            <div className="mt-2">
              <AcceptDeadline acceptBy={order.acceptBy} now={now} />
            </div>
          )}
          {isAdmin && (
            <Link href="/settings/integrations/sales-channels#unmapped" className="mt-2 inline-block font-semibold underline">
              Link these items
            </Link>
          )}
        </div>
      )}

      {!waiting && !needsMapping && (
        <p className="mt-2 text-[12.5px] text-text-muted">{CHANNEL_STATE_HINTS[order.state] ?? ""}</p>
      )}

      {accepted && scheduled && (
        <p className="mt-2 text-[13px] text-text-secondary dark:text-zinc-300">
          {order.scheduledFor && <>Scheduled for {new Date(order.scheduledFor).toLocaleString()}. </>}
          {order.confirmedAt ? (
            <span className="font-semibold">Confirmed {relativeTime(order.confirmedAt)}.</span>
          ) : order.confirmBy ? (
            <span className="font-semibold text-warning-text dark:text-amber-400">
              Confirm it by {new Date(order.confirmBy).toLocaleString()}.
            </span>
          ) : (
            <span className="font-semibold text-warning-text dark:text-amber-400">It still needs to be confirmed.</span>
          )}
        </p>
      )}
      {accepted && order.readyAt && (
        <p className="mt-1 text-[13px] font-semibold text-text-secondary dark:text-zinc-300">
          Marked ready for collection {relativeTime(order.readyAt)}.
        </p>
      )}

      {mismatch > 0 && (
        <p className="mt-2 flex items-start gap-1.5 text-[12.5px] text-text-muted">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
          <span>
            The marketplace price differs from your catalogue price on {mismatch} {mismatch === 1 ? "line" : "lines"}. The
            marketplace price was kept, because that is what the customer paid.
          </span>
        </p>
      )}

      {order.lastError && <p className="mt-2 text-[12.5px] text-danger-text dark:text-red-400">{order.lastError}</p>}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {waiting && (
          <Button variant="primary" loading={busy} onClick={() => onAccept(order)}>
            Accept order
          </Button>
        )}
        {canConfirm && (
          <Button variant="primary" loading={busy} onClick={() => onConfirmScheduled!(order)}>
            Confirm scheduled order
          </Button>
        )}
        {canReady && (
          <Button variant="secondary" disabled={busy} onClick={() => onReady!(order)}>
            Ready for collection
          </Button>
        )}
        {(waiting || needsMapping) && (
          <Button variant="danger" disabled={busy} onClick={() => onReject(order)}>
            Reject
          </Button>
        )}
        {order.orderId !== null && (
          <Link
            href={`/orders?orderId=${order.orderId}`}
            className="ms-auto text-[13px] font-semibold text-accent-text underline-offset-2 hover:underline dark:text-accent"
          >
            View order #{order.shopOrderNumber ?? order.orderId}
          </Link>
        )}
      </div>
      <p className="mt-2 text-[11.5px] text-text-faint">
        Marketplace status: {externalStatusLabel(order.externalStatus)}
        {order.alerted ? ". WhatsApp alert queued for the outlet." : ""}
      </p>
    </article>
  );
}
