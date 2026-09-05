"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { Check, Clock, Heart, Leaf, Shield, Star, Truck, type LucideIcon } from "lucide-react";
import { themeTextPresetStyle } from "@/lib/theme-element-style";
import { useCountUp } from "@/lib/use-count-up";
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
            {items.map((b, i) => {
              const Icon = TRUST_ICON[(b.settings.icon as string) ?? "check"] ?? Check;
              return (
                <span key={b.id} className="inline-flex items-center gap-2 text-sm theme-stagger-child" style={{ "--i": i } as CSSProperties}>
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
            countUp={ratingBlock?.settings.countUp === true}
          />
        )}
      </div>
    </div>
  );
}

// §8.7 item 3 — countUp animates `rating` only, never `label` (free text with
// no stored numeric field — 'Trusted by thousands' has no number to parse at
// all). Stars stay driven by the real, final `rating`, not the animating
// value, to avoid flickering through fill states as the number ramps up.
//
// Uses its own IntersectionObserver rather than ScrollAnimatedWrapper's:
// that wrapper renders bare children with no observer at all when the
// section's motion.entrance is 'none' (the same trap section.settings.motion
// .stagger already fell into), so reusing it would make count-up silently
// inert on a trust_bar with no configured entrance. One-shot (unobserve
// after first intersect) — no replay.
function RatingBadge({ rating, label, url, countUp }: { rating: number; label: string; url: string; countUp: boolean }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (!countUp || inView) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setInView(true);
          observer.unobserve(el);
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [countUp, inView]);

  const animatedRating = useCountUp(rating, countUp && inView);
  const displayRating = countUp ? animatedRating : rating;

  const rounded = Math.round(Math.max(0, Math.min(5, rating)));
  const stars = (
    <span className="inline-flex" aria-hidden="true">
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={`size-4 ${n <= rounded ? "fill-amber-400 text-amber-400" : "text-zinc-300"}`} />
      ))}
    </span>
  );
  const inner = (
    <span ref={ref} className="inline-flex items-center gap-2 text-sm font-medium">
      {stars}
      {displayRating.toFixed(1)}
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
