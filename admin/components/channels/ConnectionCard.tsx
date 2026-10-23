"use client";

import { useState } from "react";
import Link from "next/link";
import { Pencil, ShieldCheck, Hourglass, Trash2 } from "lucide-react";
import Button from "@/components/ui/Button";
import Toggle from "@/components/ui/Toggle";
import Tooltip from "@/components/ui/Tooltip";
import InlineErrorMessage from "@/components/ui/InlineErrorMessage";
import { ConnectionStatusBadge } from "@/components/channels/ChannelBadges";
import { connectionStatus, enableBlockedReason, providerLabel, verificationView } from "@/lib/channels";
import { relativeTime } from "@/lib/format";
import type { ChannelConnection, ChannelProviderInfo, Outlet } from "@/lib/types";

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-text-faint">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm ${value ? "font-mono text-text-primary dark:text-zinc-100" : "text-text-muted"}`}>
        {value ?? "Not set"}
      </dd>
    </div>
  );
}

// One (outlet, marketplace) connection: where it points, whether Requital has
// verified the location, the switch, and the last thing that went wrong.
export default function ConnectionCard({
  connection: c,
  provider,
  providers,
  outlet,
  flagOn,
  busy,
  checking,
  error,
  onToggle,
  onTest,
  onEdit,
  onDelete,
  requestingVerification = false,
  onRequestVerification,
  onAutoConfirm,
  onAvailability,
  now,
}: {
  connection: ChannelConnection;
  provider: ChannelProviderInfo | undefined;
  providers: ChannelProviderInfo[];
  outlet: Outlet | undefined;
  flagOn: boolean;
  busy: boolean;
  // true while the connection test behind "turn on" is running
  checking: boolean;
  error: string | null;
  onToggle: (c: ChannelConnection, next: boolean) => void;
  onTest: (c: ChannelConnection) => void;
  onEdit: (c: ChannelConnection) => void;
  onDelete: (c: ChannelConnection) => void;
  requestingVerification?: boolean;
  onRequestVerification?: (c: ChannelConnection) => void;
  onAutoConfirm?: (c: ChannelConnection, next: boolean) => void;
  onAvailability?: (c: ChannelConnection) => void;
  now?: number;
}) {
  const name = providerLabel(c.provider, providers);
  const outletName = outlet?.name ?? `Outlet ${c.outletId}`;
  const reason = enableBlockedReason(c, provider, flagOn);
  const verification = verificationView(c, provider);
  const status = connectionStatus(c, provider);
  const alertNumber = outlet?.whatsapp || outlet?.phone || null;
  const reasonId = `reason-${c.id}`;
  // A merchant may ask again a day after the last request (the server enforces it).
  const requestedAt = c.verificationRequestedAt ? new Date(c.verificationRequestedAt) : null;
  const [clock] = useState(() => now ?? Date.now());
  const askedToday = requestedAt !== null && clock - requestedAt.getTime() < 24 * 3_600_000;
  const caps = provider?.capabilities;

  return (
    <article aria-label={`${name} at ${outletName}`} className="rounded-2xl border border-border bg-surface p-4 dark:border-white/10 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-[15px] font-bold text-text-primary dark:text-zinc-50">
          {name} <span className="font-medium text-text-muted">at {outletName}</span>
        </h4>
        <ConnectionStatusBadge status={status} />
        <div className="ms-auto flex items-center gap-1">
          <Tooltip label={`Edit ${name} at ${outletName}`}>
            <button
              type="button"
              onClick={() => onEdit(c)}
              aria-label={`Edit ${name} at ${outletName}`}
              className="cursor-pointer rounded p-1.5 text-text-muted transition-colors hover:bg-black/5 hover:text-zinc-800 dark:hover:bg-white/10 dark:hover:text-zinc-200"
            >
              <Pencil className="size-4" />
            </button>
          </Tooltip>
          <Tooltip label={`Delete ${name} at ${outletName}`} align="end">
            <button
              type="button"
              onClick={() => onDelete(c)}
              aria-label={`Delete ${name} at ${outletName}`}
              className="cursor-pointer rounded p-1.5 text-text-muted transition-colors hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-950"
            >
              <Trash2 className="size-4" />
            </button>
          </Tooltip>
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field label="Location ID" value={c.externalLocationId} />
        <Field label="Brand ID" value={c.externalBrandId} />
        <Field label="Site ID" value={c.externalSiteId} />
        <Field label="Credentials" value={c.hasCredentials ? "Saved, hidden" : null} />
      </dl>

      <div className="mt-3 flex items-start gap-2 rounded-xl bg-page p-3 text-[13px] dark:bg-white/[0.04]">
        {verification === "waiting" ? (
          <Hourglass className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
        ) : (
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent-text dark:text-accent" aria-hidden="true" />
        )}
        <div>
          {verification === "verified" && (
            <p>
              <span className="font-semibold">Location verified.</span> Requital confirmed this location with the marketplace.
            </p>
          )}
          {verification === "automatic" && (
            <p>
              <span className="font-semibold">Checked when you turn it on.</span> The marketplace confirms the location with your
              credentials, so there is no separate verification step.
            </p>
          )}
          {verification === "waiting" && (
            <div className="space-y-2">
              <p>
                <span className="font-semibold">Waiting for Requital to verify your location.</span> Before orders can flow,
                Requital confirms your location ID with the marketplace. Check the ids above, then ask for verification. Changing
                the location ID or the credentials starts this check again.
              </p>
              {requestedAt && (
                <p className="text-text-muted">
                  Requested on {requestedAt.toLocaleDateString()}. {askedToday ? "Requital has been asked and will confirm it." : "You can ask again."}
                </p>
              )}
              {onRequestVerification && !askedToday && (
                <Button
                  size="sm"
                  variant="secondary"
                  loading={requestingVerification}
                  disabled={busy || !flagOn || !c.externalLocationId}
                  onClick={() => onRequestVerification(c)}
                  title={!c.externalLocationId ? "Set the location ID first." : undefined}
                >
                  {requestedAt ? "Request again" : "Request verification"}
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Toggle
          checked={c.enabled}
          onChange={(next) => onToggle(c, next)}
          disabled={busy || (!c.enabled && reason !== null)}
          label={`Receive ${name} orders at ${outletName}`}
          describedBy={reason ? reasonId : undefined}
        />
        <span className="text-sm font-medium text-text-primary dark:text-zinc-100">
          {checking ? `Checking the connection with ${name}...` : c.enabled ? "Receiving orders" : "Not receiving orders"}
        </span>
        <Button size="sm" variant="secondary" className="ms-auto" onClick={() => onTest(c)} disabled={busy || !flagOn || !c.hasCredentials || !c.externalLocationId}
          title={!flagOn ? "Marketplace channels are not available for your shop yet." : undefined}>
          Test connection
        </Button>
      </div>
      {(caps?.scheduledConfirm && onAutoConfirm) || (caps?.itemAvailability && c.enabled && c.externalBrandId && c.externalSiteId && onAvailability) ? (
        <div className="mt-3 space-y-3 border-t border-border pt-3 dark:border-white/10">
          {caps?.scheduledConfirm && onAutoConfirm && (
            <div className="flex flex-wrap items-start gap-3">
              <Toggle
                checked={c.autoConfirmScheduled}
                onChange={(next) => onAutoConfirm(c, next)}
                disabled={busy}
                label={`Confirm scheduled ${name} orders automatically at ${outletName}`}
              />
              <p className="min-w-0 flex-1 basis-60 text-[12.5px] text-text-muted">
                <span className="font-semibold text-text-primary dark:text-zinc-100">Confirm scheduled orders automatically.</span>{" "}
                Off by default. When on, Requital confirms an accepted scheduled order shortly before the marketplace&apos;s deadline,
                which commits you to prepare it. When off, you get one WhatsApp alert and press Confirm scheduled order in Orders,
                Marketplace.
              </p>
            </div>
          )}
          {caps?.itemAvailability && c.enabled && c.externalBrandId && c.externalSiteId && onAvailability && (
            <div className="flex flex-wrap items-center gap-3">
              <Button size="sm" variant="secondary" onClick={() => onAvailability(c)} disabled={busy}>
                Item availability
              </Button>
              <p className="min-w-0 flex-1 basis-60 text-[12.5px] text-text-muted">Mark linked items sold out or available again at {name}.</p>
            </div>
          )}
        </div>
      ) : null}
      {reason && (
        <p id={reasonId} className="mt-1.5 text-xs text-text-muted">
          {reason}
        </p>
      )}

      {error && <InlineErrorMessage className="mt-3">{error}</InlineErrorMessage>}
      {!error && c.lastError && (
        <p className="mt-3 text-[12.5px] text-danger-text dark:text-red-400">
          Last problem: {c.lastError}
          {c.lastSyncAt ? ` (${relativeTime(c.lastSyncAt)})` : ""}
        </p>
      )}
      {!c.lastError && c.lastSyncAt && c.lastSyncStatus === "ok" && (
        <p className="mt-3 text-[12.5px] text-text-muted">Last check passed {relativeTime(c.lastSyncAt)}.</p>
      )}

      <p className="mt-3 text-[12.5px] text-text-muted">
        {alertNumber ? (
          <>
            When a new order arrives, a WhatsApp alert is sent to <span className="font-mono">{alertNumber}</span>. It carries no
            customer details.{" "}
          </>
        ) : (
          <>This outlet has no WhatsApp or phone number, so you will not be alerted when a marketplace order arrives. </>
        )}
        <Link href={`/settings/outlets/${c.outletId}/edit`} className="font-semibold text-accent-text hover:underline dark:text-accent">
          {alertNumber ? "Change the outlet number" : "Add a number to the outlet"}
        </Link>
      </p>
    </article>
  );
}
