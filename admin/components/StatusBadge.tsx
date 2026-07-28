// Pill shape adapted from "Status Badge" by Serafim on 21st.dev
// (https://21st.dev/@serafimcloud/components/status-badge, itself credited
// there as "inspired by Tremor") — rounded-full bordered pill with a leading
// dot, swapped in place of the old solid-fill badge. Tremor-specific classes
// (rounded-tremor-full, text-tremor-label) were translated to this project's
// plain Tailwind palette rather than pulling in the Tremor preset.
const DOT_STYLES: Record<string, string> = {
  pending: "bg-amber-500",
  confirmed: "bg-blue-500",
  preparing: "bg-indigo-500",
  out_for_delivery: "bg-purple-500",
  delivered: "bg-green-500",
  cancelled: "bg-red-500",
  unpaid: "bg-amber-500",
  paid: "bg-green-500",
  refunded: "bg-zinc-400",
  open: "bg-green-500",
  closed: "bg-red-500",
  // External delivery (courier handoff) statuses — distinct from the
  // order's own status above, see externaldelivery model.
  picked_up: "bg-blue-500",
  failed: "bg-red-500",
};

export default function StatusBadge({ status }: { status: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-black/10 dark:border-white/15 bg-white dark:bg-zinc-900 px-2.5 py-1 text-xs font-medium capitalize text-zinc-700 dark:text-zinc-200">
      <span
        className={`size-1.5 rounded-full ${DOT_STYLES[status] ?? "bg-zinc-400"}`}
        aria-hidden="true"
      />
      {status.replace(/_/g, " ")}
    </span>
  );
}
