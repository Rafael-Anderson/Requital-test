import Tooltip from "./ui/Tooltip";

// Solid-tint status chip (2026-08 admin redesign) — replaces the old
// bordered-pill-with-leading-dot treatment. Every status this component
// renders (order status, paymentStatus, externaldelivery.status, open/
// closed) is bucketed into one of the design system's four chip categories
// (accent/warning/danger/neutral) rather than getting its own unique color,
// matching the design handoff's "Status chip" spec.
//
// Tooltip copy is keyed by order-status values only (pending/confirmed/...)
// — this component is also reused for paymentStatus/externaldelivery.status/
// open-closed, whose values never collide with these keys, so a flat lookup
// stays safe without a separate "kind" prop. Those other statuses are
// already fully explained by their own visible label (paid/unpaid/open/
// closed/etc.) and get no tooltip.
const ORDER_STATUS_TOOLTIPS: Record<string, string> = {
  pending: "Order placed. Stock has not been reserved yet.",
  confirmed: "Stock has been deducted for this order.",
  preparing: "The merchant is preparing this order.",
  out_for_delivery: "The order is on its way, or ready for pickup.",
  delivered: "The order was completed successfully.",
  cancelled: "The order was cancelled and any deducted stock was restored.",
};

type ChipCategory = "accent" | "warning" | "danger" | "neutral";

const CHIP_STYLES: Record<ChipCategory, string> = {
  accent: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  warning: "bg-warning-bg text-warning-text dark:bg-amber-500/15 dark:text-amber-400",
  danger: "bg-danger-bg text-danger-text dark:bg-red-500/15 dark:text-red-400",
  neutral: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_CATEGORY: Record<string, ChipCategory> = {
  pending: "warning",
  unpaid: "warning",
  confirmed: "accent",
  preparing: "accent",
  out_for_delivery: "accent",
  delivered: "accent",
  paid: "accent",
  open: "accent",
  // External delivery (courier handoff) statuses — distinct from the
  // order's own status above, see externaldelivery model.
  picked_up: "accent",
  cancelled: "danger",
  failed: "danger",
  refunded: "neutral",
  closed: "neutral",
};

export default function StatusBadge({ status }: { status: string }) {
  const category = STATUS_CATEGORY[status] ?? "neutral";
  const badge = (
    <span
      className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold capitalize ${CHIP_STYLES[category]}`}
    >
      {status.replace(/_/g, " ")}
    </span>
  );

  const tooltip = ORDER_STATUS_TOOLTIPS[status];
  if (!tooltip) return badge;
  return <Tooltip label={tooltip}>{badge}</Tooltip>;
}
