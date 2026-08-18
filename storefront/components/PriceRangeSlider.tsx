"use client";

// Two draggable handles over one track (storefront-v2 Phase 2B) — the CSS
// double-handle trick (two overlapping native <input type="range">, see
// globals.css's .range-thumb rules for how the track ignores pointer events
// so only each thumb is draggable), not a slider library.
export default function PriceRangeSlider({
  min,
  max,
  value,
  onChange,
  currency,
}: {
  min: number;
  max: number;
  value: [number, number];
  onChange: (value: [number, number]) => void;
  currency?: string;
}) {
  const [lo, hi] = value;
  const span = max - min || 1;
  const loPct = ((lo - min) / span) * 100;
  const hiPct = ((hi - min) / span) * 100;

  if (min >= max) return null;

  return (
    <div className="w-full min-w-40">
      <div className="relative h-4 flex items-center">
        <div className="absolute inset-x-0 h-1 rounded-full bg-black/10" />
        <div className="absolute h-1 rounded-full bg-accent" style={{ left: `${loPct}%`, right: `${100 - hiPct}%` }} />
        <input
          type="range"
          aria-label="Minimum price"
          min={min}
          max={max}
          value={lo}
          onChange={(e) => onChange([Math.min(Number(e.target.value), hi), hi])}
          className="range-thumb absolute inset-x-0 w-full h-4 bg-transparent"
        />
        <input
          type="range"
          aria-label="Maximum price"
          min={min}
          max={max}
          value={hi}
          onChange={(e) => onChange([lo, Math.max(Number(e.target.value), lo)])}
          className="range-thumb absolute inset-x-0 w-full h-4 bg-transparent"
        />
      </div>
      <p className="mt-1.5 text-xs text-zinc-500 whitespace-nowrap">
        {currency} {lo.toLocaleString()} – {currency} {hi.toLocaleString()}
      </p>
    </div>
  );
}
