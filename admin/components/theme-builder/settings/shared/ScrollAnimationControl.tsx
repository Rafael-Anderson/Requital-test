"use client";

import Select from "@/components/ui/Select";
import Toggle from "@/components/ui/Toggle";
import type { ScrollAnimation } from "@/lib/types";

const OPTIONS: { value: ScrollAnimation; label: string }[] = [
  { value: "none", label: "None" },
  { value: "fade-in", label: "Fade in" },
  { value: "slide-up", label: "Slide up" },
  { value: "slide-left", label: "Slide left" },
  { value: "slide-right", label: "Slide right" },
];

// Post-G0 batch — an optional "Stagger items" toggle, shown only by the
// list-rendering sections that pass onStaggerChange (product_grid,
// featured_collections, testimonials, trust_bar, brands, product_tabs).
// Writes section.settings.motion.stagger — a different field than the Select
// above (which stays bound to the legacy settings.scrollAnimation), so every
// other caller of this shared control is unaffected.
export default function ScrollAnimationControl({
  value,
  onChange,
  label = "Scroll animation",
  stagger,
  onStaggerChange,
}: {
  value: ScrollAnimation | undefined;
  onChange: (next: ScrollAnimation) => void;
  label?: string;
  stagger?: boolean;
  onStaggerChange?: (next: boolean) => void;
}) {
  return (
    <div className="space-y-3">
      <Select
        label={label}
        value={value ?? "none"}
        onChange={(e) => onChange(e.target.value as ScrollAnimation)}
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </Select>
      {onStaggerChange && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">
            Stagger items
            <span className="block text-xs font-normal text-zinc-500">Items fade in one after another instead of all at once.</span>
          </span>
          <Toggle checked={stagger === true} onChange={onStaggerChange} />
        </div>
      )}
    </div>
  );
}
