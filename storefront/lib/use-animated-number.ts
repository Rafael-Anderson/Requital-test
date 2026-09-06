"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "./use-reduced-motion";

const FALLBACK_DURATION_MS = 600; // 'standard' intensity's durationSlow (lib/motion.ts).

function readDurationMs(): number {
  if (typeof window === "undefined") return FALLBACK_DURATION_MS;
  const raw = getComputedStyle(document.documentElement).getPropertyValue("--motion-duration-slow").trim();
  const parsed = parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : FALLBACK_DURATION_MS;
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);

// §8.13.C item 13 — tweens from whatever is currently shown to a new `value`
// each time `value` changes (the cart subtotal). Distinct from useCountUp,
// which ramps 0 → target on an external trigger and only ever dips down once;
// this tracks a live number that goes up AND down.
//
// First render, reduced motion, and the steady state all return the real
// number verbatim — byte-identical to a plain `{value}`. Every setState is
// inside the rAF callback (the lint-endorsed "respond to an external update"
// shape), never synchronously in the effect body. `displayRef` mirrors the
// shown value via a passive effect so a change landing mid-tween animates
// from the current on-screen number, not a stale target.
export function useAnimatedNumber(value: number, enabled = true): number {
  const [display, setDisplay] = useState(value);
  const reducedMotion = useReducedMotion();
  const displayRef = useRef(value);
  const rafRef = useRef(0);
  const active = enabled && !reducedMotion;

  useEffect(() => {
    displayRef.current = display;
  });

  useEffect(() => {
    if (!active || displayRef.current === value) return;
    const from = displayRef.current;
    const duration = readDurationMs();
    let start: number | null = null;
    function step(now: number) {
      if (start === null) start = now;
      const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
      setDisplay(from + (value - from) * easeOutCubic(t));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
      else setDisplay(value);
    }
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value, active]);

  return active ? display : value;
}
