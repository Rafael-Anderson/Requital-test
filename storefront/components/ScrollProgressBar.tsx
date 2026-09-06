"use client";

import { useShop } from "@/lib/shop-context";
import { useScrollValue } from "@/lib/use-scroll-value";

// §8.13.C item 14 — a fixed bar at the top of the viewport whose fill tracks
// scroll depth. Gated on globalSettings.motion.scrollProgressBar; renders
// nothing when unset. It's a position indicator, not a motion flourish (no
// transition — it just follows the scroll), so it stays on under
// prefers-reduced-motion. useScrollValue is the one shared rAF-throttled
// scroll subscription (Phase A).
export default function ScrollProgressBar() {
  const { themeConfig } = useShop();
  const { y } = useScrollValue();

  if (!themeConfig?.globalSettings.motion?.scrollProgressBar) return null;

  const max =
    typeof document !== "undefined"
      ? document.documentElement.scrollHeight - window.innerHeight
      : 0;
  const pct = max > 0 ? Math.min(1, Math.max(0, y / max)) : 0;

  return (
    <div className="fixed inset-x-0 top-0 z-[60] h-0.5 bg-transparent" aria-hidden="true">
      <div
        className="h-full bg-accent origin-left"
        style={{ transform: `scaleX(${pct})` }}
      />
    </div>
  );
}
