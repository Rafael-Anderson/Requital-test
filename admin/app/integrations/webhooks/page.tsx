"use client";

import { useEffect, useState } from "react";
import { getWebhookLog } from "@/lib/api";
import type { WebhookEvent } from "@/lib/types";
import { Table, THead, TBody, TH, TR, TD } from "@/components/ui/Table";
import { TableSkeleton } from "@/components/ui/Skeleton";
import EmptyState from "@/components/ui/EmptyState";
import PageShell from "@/components/ui/PageShell";

const SOURCE_LABELS: Record<string, string> = {
  slider: "Slider",
  stripe: "Stripe",
  paypal: "PayPal",
  tabby: "Tabby",
  tamara: "Tamara",
  telr: "Telr",
  paytabs: "PayTabs",
  nomod: "Nomod",
};

// A small local badge, not StatusBadge — that component's category map is
// keyed by real order/payment/delivery status strings (some of which,
// e.g. "delivered"/"cancelled", carry their own order-specific tooltip
// text) and reusing those exact strings here just for their color would
// surface a misleading tooltip on an unrelated webhook-log row.
const RESULT_STYLES: Record<WebhookEvent["result"], string> = {
  success: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  duplicate: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
  rejected: "bg-danger-bg text-danger-text dark:bg-red-500/15 dark:text-red-400",
  failed: "bg-danger-bg text-danger-text dark:bg-red-500/15 dark:text-red-400",
};

function ResultBadge({ result }: { result: WebhookEvent["result"] }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${RESULT_STYLES[result]}`}
    >
      {result}
    </span>
  );
}

// Read-only diagnostics — "did the webhook even arrive" is the #1
// troubleshooting question for "why didn't my order update." Deliberately
// shows no webhook URL or token anywhere (those are platform-level, not
// per-shop — see CLAUDE.md's Slider/webhook-log notes).
export default function WebhooksIntegrationsPage() {
  const [events, setEvents] = useState<WebhookEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getWebhookLog()
      .then(setEvents)
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load webhook activity"));
  }, []);

  return (
    <PageShell variant="form">
      <p className="text-xs text-text-faint mb-4">
        The last 20 webhook deliveries received for your store — useful for checking whether a delivery or
        payment update actually arrived.
      </p>

      {error && <p className="text-red-600 text-sm mb-3">{error}</p>}

      <Table>
        <THead>
          <tr>
            <TH>Time</TH>
            <TH>Source</TH>
            <TH>Event</TH>
            <TH>Result</TH>
          </tr>
        </THead>
        <TBody>
          {events === null ? (
            <tr>
              <td colSpan={4}>
                <TableSkeleton rows={6} cols={4} />
              </td>
            </tr>
          ) : events.length === 0 && !error ? (
            <tr>
              <td colSpan={4}>
                <EmptyState
                  title="No webhook activity yet"
                  description="Deliveries and payment updates will show up here as they arrive."
                />
              </td>
            </tr>
          ) : (
            events.map((event) => (
              <TR key={event.id}>
                <TD className="text-xs text-text-muted">{new Date(event.createdAt).toLocaleString()}</TD>
                <TD className="font-medium">{SOURCE_LABELS[event.source] ?? event.source}</TD>
                <TD className="text-text-muted capitalize">{event.eventType.replace(/_/g, " ")}</TD>
                <TD>
                  <ResultBadge result={event.result} />
                </TD>
              </TR>
            ))
          )}
        </TBody>
      </Table>
    </PageShell>
  );
}
