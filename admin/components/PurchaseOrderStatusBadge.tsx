import { PURCHASE_ORDER_STATUS_LABELS, type PurchaseOrderStatus } from "@/lib/types";

const STYLES: Record<PurchaseOrderStatus, string> = {
  draft: "bg-neutral-chip-bg text-neutral-chip-text dark:bg-zinc-800 dark:text-zinc-400",
  sent: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  partially_received: "bg-warning-bg text-warning-text dark:bg-amber-500/15 dark:text-amber-400",
  received: "bg-accent-tint text-accent-text dark:bg-accent/15 dark:text-accent",
  cancelled: "bg-danger-bg text-danger-text dark:bg-red-500/15 dark:text-red-400",
};

export default function PurchaseOrderStatusBadge({ status }: { status: PurchaseOrderStatus }) {
  return (
    <span className={`inline-flex w-fit items-center rounded-full px-2.5 py-1 text-[11.5px] font-bold ${STYLES[status]}`}>
      {PURCHASE_ORDER_STATUS_LABELS[status]}
    </span>
  );
}
