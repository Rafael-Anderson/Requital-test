"use client";

import Link from "next/link";
import Select from "@/components/ui/Select";
import SpacingControls, { type SpacingValue } from "./shared/SpacingControls";
import BackgroundControls, { type BackgroundValue } from "./shared/BackgroundControls";
import ScrollAnimationControl from "./shared/ScrollAnimationControl";
import VisibilityControl from "./shared/VisibilityControl";
import type { ScrollAnimation, SectionVisibility } from "@/lib/types";

// Real reviews only: the section shows reviews the merchant approved under
// Customers > Reviews (customers who agreed to publish their survey feedback).
// There is no content to author here, only how many to show and a floor on the
// rating. Both keys are optional; unset = up to 6 reviews, any rating.
export default function TestimonialsSettings({
  settings,
  onUpdate,
}: {
  settings: Record<string, unknown>;
  onUpdate: (key: string, value: unknown) => void;
}) {
  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border p-3 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
        This section shows only real reviews. Turn on &ldquo;Show on store&rdquo; for a customer&apos;s feedback under{" "}
        <Link href="/customers/reviews" className="underline">
          Customers &gt; Reviews
        </Link>
        . A customer must have agreed to publish it. Until at least one review is approved the section stays hidden on
        your live store.
      </div>
      <Select
        label="Maximum reviews"
        value={String(typeof settings.maxItems === "number" ? settings.maxItems : 6)}
        onChange={(e) => onUpdate("maxItems", Number(e.target.value))}
      >
        {[3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => (
          <option key={n} value={n}>
            {n}
          </option>
        ))}
      </Select>
      <Select
        label="Minimum rating"
        value={String(typeof settings.minRating === "number" ? settings.minRating : "")}
        onChange={(e) => onUpdate("minRating", e.target.value === "" ? undefined : Number(e.target.value))}
      >
        <option value="">Any rating</option>
        {[2, 3, 4, 5].map((n) => (
          <option key={n} value={n}>
            {n} stars and up
          </option>
        ))}
      </Select>
      <SpacingControls
        value={settings.spacing as SpacingValue}
        onChange={(v) => onUpdate("spacing", v)}
      />
      <BackgroundControls
        value={settings.background as BackgroundValue}
        onChange={(v) => onUpdate("background", v)}
      />
      <ScrollAnimationControl
        value={settings.scrollAnimation as ScrollAnimation}
        onChange={(v) => onUpdate("scrollAnimation", v)}
        stagger={(settings.motion as { stagger?: boolean } | undefined)?.stagger}
        onStaggerChange={(v) => onUpdate("motion", { ...(settings.motion as object), stagger: v })}
      />
      <VisibilityControl
        value={settings.visibility as SectionVisibility}
        onChange={(v) => onUpdate("visibility", v)}
      />
    </div>
  );
}
