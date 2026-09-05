"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const FALLBACK_DURATION_MS = 600; // 'standard' intensity's own durationSlow (lib/motion.ts) — a
// coherent default for an unconfigured shop, not a new invented number.

function readDurationMs(): number {
  if (typeof window === "undefined") return FALLBACK_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--motion-duration-slow").trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_DURATION_MS;
}

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// §8.7 item 3 — first real consumer of `useReducedMotion()` beyond MobileNav,
// and the first shared JS-animation utility since MobileNav's swipe math.
// Deliberately does NOT read useScrollValue() — this is an elapsed-wall-clock
// animation (driven by rAF's own timestamp), not a scroll-position one; the
// two hooks are unrelated.
//
// `active` is the caller's own trigger (e.g. an IntersectionObserver result)
// — this hook owns none of that, only the count math itself.
//
// Initial/inactive state is `target`, not 0: SSR and any pre-hydration or
// pre-trigger render shows the real, correct number (byte-identical to
// today's static rendering) — count-up only ever dips to 0 and ramps back up
// to the SAME value once `active` flips true, a "ta-da" layered on top of an
// always-correct value, never a replacement for it. Achieved by returning
// `target` directly whenever not animating, rather than syncing state via a
// synchronous setState in the effect body (which the react-hooks lint rule
// flags — every setValue call here happens inside the rAF callback, the
// officially-endorsed "calling setState in response to an external update"
// shape, never synchronously in the effect body itself).
//
// Self-gates on reduced motion: active + reduced-motion returns `target`
// immediately, no rAF loop scheduled at all — "neutralize the animation,
// never break the feature."
//
// Duration is not a caller option, matching the catalog's own minimal
// `useCountUp(target)` sketch — it reads `--motion-duration-slow` (the
// first runtime *read* of a --motion-* token; every prior consumer only
// ever set one).
export function useCountUp(target: number, active: boolean): number {
  const [value, setValue] = useState(target);
  const reducedMotion = useReducedMotion();
  const rafRef = useRef(0);
  const animating = active && !reducedMotion;

  useEffect(() => {
    if (!animating) return;
    const duration = readDurationMs();
    let start: number | null = null;
    function step(now: number) {
      if (start === null) start = now;
      const t = duration > 0 ? Math.min(1, (now - start!) / duration) : 1;
      if (t >= 1) {
        setValue(target);
        return;
      }
      setValue(target * easeOutCubic(t));
      rafRef.current = requestAnimationFrame(step);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [animating, target]);

  return animating ? value : target;
}
