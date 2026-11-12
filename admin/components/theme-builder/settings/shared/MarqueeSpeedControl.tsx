"use client";

import Slider from "@/components/ui/Slider";
import {
  MARQUEE_SPEED_DEFAULT,
  MARQUEE_SPEED_MAX,
  MARQUEE_SPEED_MIN,
  effectiveMarqueeSpeed,
} from "@/lib/marquee-speed";

// Scroll speed of a scrolling (marquee) announcement bar, in pixels per second. The speed is
// the same whatever the message length or screen width. Stored as a number; "Use default"
// stores null, which the storefront reads as the default speed.
export default function MarqueeSpeedControl({
  value,
  onChange,
}: {
  value: number | null | undefined;
  onChange: (next: number | null) => void;
}) {
  const isSet = typeof value === "number";
  return (
    <div className="space-y-1">
      <Slider
        label="Speed"
        value={effectiveMarqueeSpeed(value)}
        min={MARQUEE_SPEED_MIN}
        max={MARQUEE_SPEED_MAX}
        step={5}
        suffix="px/s"
        onChange={(v) => onChange(effectiveMarqueeSpeed(v))}
      />
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span>Slower</span>
        {isSet ? (
          <button type="button" onClick={() => onChange(null)} className="text-accent-text hover:underline">
            Use default ({MARQUEE_SPEED_DEFAULT} px/s)
          </button>
        ) : (
          <span>Default ({MARQUEE_SPEED_DEFAULT} px/s)</span>
        )}
        <span>Faster</span>
      </div>
    </div>
  );
}
