import { Globe, PenLine, Store } from "lucide-react";
import { CHIP, ChannelSourceBadge } from "@/components/channels/ChannelBadges";
import { isMarketplaceChannel } from "@/lib/channels";
import { orderSourceEntry, showsSourceTag } from "@/lib/order-sources";

const ICONS = { globe: Globe, pen: PenLine, store: Store } as const;

// The shared chip tones, except neutral: its faint text is meant for a quiet
// status, and a source tag must stay readable at card size.
const TONE = {
  ...CHIP,
  neutral: "bg-neutral-chip-bg text-text-secondary dark:bg-zinc-800 dark:text-zinc-300",
};

// Where an order came from, as a compact pill (lib/order-sources.ts). Website
// orders stay untagged. Colours are the existing chip tones; logical spacing
// only, so it reads the same in RTL.
export default function OrderSourceTag({
  order,
  className = "",
}: {
  order: { source?: string | null; channel?: string | null };
  className?: string;
}) {
  const entry = orderSourceEntry(order.source);
  if (!entry || !showsSourceTag(entry.key)) {
    // A marketplace with no registry entry (the test marketplace) keeps its
    // existing badge so it never reads as a website order.
    return isMarketplaceChannel(order.channel) ? (
      <span className={`inline-block ${className}`}>
        <ChannelSourceBadge channel={order.channel!} />
      </span>
    ) : null;
  }
  const Icon = ICONS[entry.icon];
  return (
    <span
      data-testid="order-source-tag"
      data-source={entry.key}
      title={entry.label}
      className={`inline-flex w-fit shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold leading-4 ${TONE[entry.tone]} ${className}`}
    >
      <Icon className="size-3" aria-hidden="true" />
      {entry.tag}
    </span>
  );
}
