"use client";

import { useEffect, useState } from "react";

// C2 (mobile nav) is the first JS-driven animation to need this as a shared
// hook rather than an inline matchMedia check — promised in storefront's
// CLAUDE.md pre-PR checklist ("build it as the first task of whichever phase
// adds the second JS animation"). Extracted from the identical inline
// pattern in lib/announcement-rotation.ts (lazy-init from matchMedia so the
// mount effect only wires the listener, no synchronous setState in an
// effect body); HeroSlideshow and announcement-rotation keep their own
// working inline checks — no reason to touch code that already works.
export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );

  useEffect(() => {
    const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReduced(mql.matches);
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
