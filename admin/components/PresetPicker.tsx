"use client";

import type { ReactNode } from "react";
import { Check } from "lucide-react";
import Card from "@/components/ui/Card";

// Shared by every Advanced-tab preset picker (homepage/top bar/PDP/cart/
// checkout layout, icon style, button style) — same Card-grid-with-a-
// thumbnail-and-a-Check-badge shape each one needs, so adding a new preset
// group is "supply options + a thumbnail renderer," not a new copy of this
// selection UI.
export default function PresetPicker<T extends string>({
  options,
  value,
  onChange,
  renderThumbnail,
  singleColumn = false,
}: {
  options: { key: T; label: string; description?: string }[];
  value: T;
  onChange: (key: T) => void;
  renderThumbnail: (key: T) => ReactNode;
  // Layout mode (LayoutSettings.tsx) renders this inside the builder's
  // w-80 right panel, not a full-width page — the default sm:grid-cols-3
  // breakpoint is a *viewport* width check, so it still forced 3 columns
  // into a ~288px-wide parent regardless of how little room that left per
  // card (squished thumbnails, labels wrapping to one word). singleColumn
  // stacks one full-width card per row instead; the old Advanced page
  // (theme/edit/advanced) keeps the 3-column default since it's not
  // panel-constrained.
  singleColumn?: boolean;
}) {
  return (
    <div className={`grid gap-4 ${singleColumn ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-3"}`}>
      {options.map((option) => {
        const selected = value === option.key;
        return (
          <Card
            key={option.key}
            className={`cursor-pointer transition-colors ${selected ? "border-accent ring-1 ring-accent" : "hover:border-black/20 dark:hover:border-white/20"}`}
            onClick={() => onChange(option.key)}
          >
            {renderThumbnail(option.key)}
            <div className="mt-3 flex items-center justify-between gap-2">
              <p className="text-sm font-medium">{option.label}</p>
              {selected && (
                <span className="flex items-center justify-center size-5 rounded-full bg-accent text-accent-foreground shrink-0">
                  <Check className="size-3" />
                </span>
              )}
            </div>
            {option.description && <p className="text-xs text-text-muted mt-1">{option.description}</p>}
          </Card>
        );
      })}
    </div>
  );
}
