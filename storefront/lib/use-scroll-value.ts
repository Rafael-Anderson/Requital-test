"use client";

import { useEffect, useRef, useState } from "react";

// Phase A (motion foundation) — one shared, rAF-throttled scroll subscription.
// Nothing in Phase A consumes it; it ships now so the later motion phases
// (parallax, shrink / hide-on-scroll header, scroll-progress bar, scrollspy)
// each subscribe to ONE passive scroll listener instead of adding their own.
// Modelled on the rAF-throttled pointer handling already in SectionWrapper.tsx
// / PreviewInteraction.tsx.

export interface ScrollValue {
  y: number;
  direction: "up" | "down" | "none";
}

export function useScrollValue(): ScrollValue {
  const [value, setValue] = useState<ScrollValue>(() => ({
    y: typeof window === "undefined" ? 0 : window.scrollY,
    direction: "none",
  }));
  const lastY = useRef(value.y);
  const pending = useRef(false);
  const rafId = useRef(0);

  useEffect(() => {
    function read() {
      pending.current = false;
      const y = window.scrollY;
      const dy = y - lastY.current;
      lastY.current = y;
      setValue({ y, direction: dy > 0 ? "down" : dy < 0 ? "up" : "none" });
    }
    function onScroll() {
      if (pending.current) return;
      pending.current = true;
      rafId.current = requestAnimationFrame(read);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    // Sync once on mount (a page can load already scrolled).
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
    };
  }, []);

  return value;
}
