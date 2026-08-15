"use client";

import { useId } from "react";

// A range input paired with a numeric field showing/editing the same value
// — used throughout the 18-category Theme Settings panels (border
// thickness, corner radius, logo height, badge position radius, swatch
// dimensions, ...). Hand-rolled, no dependency, same as every other
// primitive in this directory.
export default function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (value: number) => void;
}) {
  const id = useId();
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
          {label}
        </label>
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={min}
            max={max}
            step={step}
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            className="h-7 w-16 rounded-md border border-black/15 bg-zinc-50 px-2 text-xs shadow-sm shadow-black/5 outline-none focus:border-accent dark:border-white/15 dark:bg-zinc-900"
          />
          {suffix && <span className="text-xs text-zinc-400">{suffix}</span>}
        </div>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}
