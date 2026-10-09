"use client";

import { useMediaQuery } from "./use-media-query";

// The shared prefers-reduced-motion hook (hydration-safe, see use-media-query.ts). Used by
// the mobile nav, hero slideshow and announcement rotation.
export function useReducedMotion(): boolean {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
