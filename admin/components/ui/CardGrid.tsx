import type { HTMLAttributes } from "react";

// The card layout every Integrations tab shares: one column below lg, two columns
// from lg up, cards aligned to the top (items-start, never stretched to the tallest
// neighbour), one equal gap. Page width itself still comes from PageShell. A card
// that needs the whole row (a long form, a wide table) adds CARD_SPAN_FULL.
//
// Logical properties only, so the same grid mirrors in RTL with no extra classes.
export const CARD_SPAN_FULL = "lg:col-span-2";

export default function CardGrid({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      data-testid="card-grid"
      className={`grid grid-cols-1 lg:grid-cols-2 gap-4 items-start ${className}`}
      {...props}
    />
  );
}
