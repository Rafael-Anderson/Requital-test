import type { CampaignStatus } from "@/lib/types";

const STYLE: Record<CampaignStatus, string> = {
  draft: "bg-zinc-100 text-zinc-700 dark:bg-white/10 dark:text-zinc-300",
  sending: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300",
  sent: "bg-green-100 text-green-800 dark:bg-green-500/20 dark:text-green-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-white/10 dark:text-zinc-400",
  failed: "bg-red-100 text-red-700 dark:bg-red-500/20 dark:text-red-300",
};
const LABEL: Record<CampaignStatus, string> = {
  draft: "Draft",
  sending: "Sending",
  sent: "Sent",
  cancelled: "Cancelled",
  failed: "Stopped",
};

export default function CampaignStatusBadge({ status }: { status: CampaignStatus }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${STYLE[status]}`}>{LABEL[status]}</span>;
}
