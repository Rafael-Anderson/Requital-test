"use client";

import { useEffect, useState } from "react";

// Shared viewport-width gate for JS-driven continuous motion (hero parallax,
// decorative parallax) — the sub-640px tier force-disables those per the
// Phase A rule (see the mobile-tier note in globals.css / plan §8.1). CSS
// media queries can't gate a JS transform whose value comes from scrollY, so
// this hook is the JS equivalent. Same lazy-init-from-matchMedia shape as
// use-reduced-motion.ts.
export function useMinWidth(px: number): boolean {
  const [matches, setMatches] = useState(
    () => typeof window !== "undefined" && window.matchMedia(`(min-width: ${px}px)`).matches,
  );

  useEffect(() => {
    const mql = window.matchMedia(`(min-width: ${px}px)`);
    const onChange = () => setMatches(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [px]);

  return matches;
}
