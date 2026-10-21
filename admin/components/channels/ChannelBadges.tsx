"use client";

import { useEffect, useState } from "react";
import { Clock, Store } from "lucide-react";
import {
  CONNECTION_STATUS_LABELS,
  channelStateLabel,
  deadlineState,
  providerLabel,
  type ConnectionStatus,
} from "@/lib/channels";

const CHIP = {
  accent: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  warning: "bg-warning-bg text-warning-text dark:bg-amber-500/15 dark:text-amber-400",
  danger: "bg-danger-bg text-danger-text dark:bg-red-500/15 dark:text-red-400",
  neutral: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
};

const STATE_CHIP: Record<string, keyof typeof CHIP> = {
  needs_mapping: "warning",
  pending_acceptance: "warning",
  accepted: "accent",
  rejected: "danger",
  cancelled_upstream: "danger",
};

// Which marketplace an order came from. Used on order cards, history rows and
// the order detail, so a marketplace order never reads as a storefront one.
export function ChannelSourceBadge({ channel }: { channel: string }) {
  return (
    <span className="inline-flex w-fit items-center gap-1 rounded-full bg-neutral-chip-bg px-2 py-0.5 text-[11px] font-bold text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-300">
      <Store className="size-3" aria-hidden="true" />
      {providerLabel(channel)}
    </span>
  );
}

export function ChannelStateBadge({ state }: { state: string }) {
  return (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold ${CHIP[STATE_CHIP[state] ?? "neutral"]}`}
    >
      {channelStateLabel(state)}
    </span>
  );
}

export function ConnectionStatusBadge({ status }: { status: ConnectionStatus }) {
  const tone: Record<ConnectionStatus, keyof typeof CHIP> = {
    live: "accent",
    off: "neutral",
    waiting_verification: "warning",
    needs_setup: "neutral",
  };
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold ${CHIP[tone[status]]}`}>
      {CONNECTION_STATUS_LABELS[status]}
    </span>
  );
}

// The marketplace's own deadline, ticking. role="timer" so a screen reader does
// not announce every second; the text changes at most every 5 seconds.
export function AcceptDeadline({ acceptBy, now: fixedNow }: { acceptBy: string | null; now?: number }) {
  const [now, setNow] = useState(() => fixedNow ?? Date.now());
  useEffect(() => {
    if (fixedNow !== undefined) return;
    const t = setInterval(() => setNow(Date.now()), 5000);
    return () => clearInterval(t);
  }, [fixedNow]);
  const d = deadlineState(acceptBy, fixedNow ?? now);
  const tone =
    d.kind === "passed"
      ? "text-danger-text dark:text-red-400"
      : d.kind === "urgent"
        ? "text-danger-text dark:text-red-400"
        : "text-warning-text dark:text-amber-400";
  return (
    <p role="timer" className={`flex items-start gap-1.5 text-[13px] font-semibold ${tone}`}>
      <Clock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
      <span>{d.text}</span>
    </p>
  );
}
