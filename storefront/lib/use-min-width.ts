"use client";

import { useMediaQuery } from "./use-media-query";

// Shared viewport-width gate for JS-driven continuous motion (hero parallax,
// decorative parallax) — the sub-640px tier force-disables those per the
// Phase A rule (see the mobile-tier note in globals.css / plan §8.1). CSS
// media queries can't gate a JS transform whose value comes from scrollY, so
// this hook is the JS equivalent. False until hydrated (use-media-query.ts).
export function useMinWidth(px: number): boolean {
  return useMediaQuery(`(min-width: ${px}px)`);
}
