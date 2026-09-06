"use client";

import type { CSSProperties } from "react";
import { useShop } from "@/lib/shop-context";
import { useScrollValue } from "@/lib/use-scroll-value";
import { useReducedMotion } from "@/lib/use-reduced-motion";
import { useMinWidth } from "@/lib/use-min-width";

// §8.13.C item 15 — motion.decorativeParallax. Bloom's signature flourish: a
// few soft accent-tinted blobs drifting behind the page on scroll. Mounted
// globally in ShopLayoutClient (like ScrollProgressBar).
//
// PERF CAP — built in, not bolted on (plan §3.5 #13 / §9.4):
//   * DECORATIVE_COUNT is a hard limit of 5. No merchant control widens it.
//   * Killed entirely by ANY of: motion.intensity 'none', prefers-reduced-
//     motion, or a sub-640px viewport (the Phase A mobile rule that also
//     force-disables parallax / kenBurns). When killed, renders `null` — no
//     scroll listener, no DOM.
//   * Each blob is position:fixed + pointer-events:none + aria-hidden +
//     behind content (z-index 0), so it never intercepts input and — being
//     fixed — is always on-screen, which makes the "off-screen pause" of an
//     absolutely-positioned decoration moot: the cap + the kill switches are
//     the guard.
//   * Transform is `translate3d(0, …, 0)` only (compositor-only), driven by
//     the ONE shared rAF-throttled useScrollValue subscription.
const DECORATIVE_COUNT = 5;

// Fixed layout per blob: viewport-relative position, size (px), scroll rate
// (fraction of scrollY translated — all < 0.2, so they lag well behind), and
// opacity. Hand-tuned, not random, so it renders identically every load.
const BLOBS: { top: string; left: string; size: number; rate: number; opacity: number }[] = [
  { top: "8%", left: "-4%", size: 220, rate: 0.05, opacity: 0.16 },
  { top: "42%", left: "82%", size: 300, rate: 0.11, opacity: 0.12 },
  { top: "70%", left: "6%", size: 180, rate: 0.08, opacity: 0.14 },
  { top: "18%", left: "60%", size: 140, rate: 0.14, opacity: 0.1 },
  { top: "88%", left: "70%", size: 240, rate: 0.06, opacity: 0.13 },
];

export default function DecorativeParallax() {
  const { themeConfig } = useShop();
  const reducedMotion = useReducedMotion();
  const wideEnough = useMinWidth(640);
  const { y } = useScrollValue();

  const motion = themeConfig?.globalSettings.motion;
  const enabled = motion?.decorativeParallax === true && motion.intensity !== "none";
  if (!enabled || reducedMotion || !wideEnough) return null;

  return (
    <div className="fixed inset-0 z-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {BLOBS.slice(0, DECORATIVE_COUNT).map((b, i) => {
        const style: CSSProperties = {
          top: b.top,
          left: b.left,
          width: b.size,
          height: b.size,
          opacity: b.opacity,
          transform: `translate3d(0, ${(y * b.rate).toFixed(1)}px, 0)`,
          willChange: "transform",
        };
        return <span key={i} className="theme-decorative-blob" style={style} />;
      })}
    </div>
  );
}
