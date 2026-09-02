"use client";

import { Check, Clock, Heart, Leaf, Shield, Star, Truck, type LucideIcon } from "lucide-react";
import { themeTextPresetStyle } from "@/lib/theme-element-style";
import type { SectionSettings, ThemeBlock } from "@/lib/theme-config-types";

const TRUST_ICON: Record<string, LucideIcon> = {
  check: Check,
  truck: Truck,
  shield: Shield,
  star: Star,
  heart: Heart,
  clock: Clock,
  leaf: Leaf,
};

// Trust / social-proof strip (theme-builder-expansion Phase 6). A row of
// `trust_item` blocks (icon + short text) plus an optional `rating_badge`.
// Purely presentational — no data fetching. Renders nothing when there is
// no visible content.
export default function TrustBarSection({
  blocks,
}: {
  sectionId: string;
  settings: SectionSettings;
  blocks: ThemeBlock[];
}) {
  const visible = [...blocks].filter((b) => b.visible).sort((a, b) => a.order - b.order);
  const headingBlock = visible.find((b) => b.type === "heading");
  const heading = typeof headingBlock?.settings.text === "string" ? headingBlock.settings.text.trim() : "";
  const items = visible.filter((b) => b.type === "trust_item" && typeof b.settings.text === "string" && b.settings.text.trim());
  const ratingBlock = visible.find((b) => b.type === "rating_badge");
  const rating = ratingBlock && typeof ratingBlock.settings.rating === "number" ? ratingBlock.settings.rating : null;

  if (items.length === 0 && rating === null && !heading) return null;

  return (
    <div className="border-y border-stroke">
      <div className="mx-auto px-4 sm:px-6 py-5 flex flex-col items-center gap-3 text-center" style={{ maxWidth: "var(--theme-max-width, 80rem)" }}>
        {heading && (
          <h2 className="text-lg font-semibold" style={themeTextPresetStyle("h3")}>
            {heading}
          </h2>
        )}
        {items.length > 0 && (
          <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
            {items.map((b) => {
              const Icon = TRUST_ICON[(b.settings.icon as string) ?? "check"] ?? Check;
              return (
                <span key={b.id} className="inline-flex items-center gap-2 text-sm">
                  <Icon className="size-4 shrink-0 text-accent" aria-hidden="true" />
                  {b.settings.text as string}
                </span>
              );
            })}
          </div>
        )}
        {rating !== null && (
          <RatingBadge
            rating={rating}
            label={typeof ratingBlock?.settings.label === "string" ? ratingBlock.settings.label : ""}
            url={typeof ratingBlock?.settings.url === "string" ? ratingBlock.settings.url : ""}
          />
        )}
      </div>
    </div>
  );
}

function RatingBadge({ rating, label, url }: { rating: number; label: string; url: string }) {
  const rounded = Math.round(Math.max(0, Math.min(5, rating)));
  const stars = (
    <span className="inline-flex" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-4 ${n <= rounded ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`} />
      ))}
    </span>
  );
  const inner = (
    <span className="inline-flex items-center gap-2 text-sm font-medium">
      {stars}
      {rating.toFixed(1)}
      {label && <span className="text-price-main font-normal">· {label}</span>}
    </span>
  );
  return url ? (
    <a href={url} target="_blank" rel="noopener noreferrer" className="hover:opacity-80">
      {inner}
    </a>
  ) : (
    inner
  );
}
