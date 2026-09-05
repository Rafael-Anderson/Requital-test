"use client";

import { useEffect, useState } from "react";
import { useScrollValue } from "./use-scroll-value";

const SHRINK_THRESHOLD_PX = 40;
const HIDE_THRESHOLD_PX = 80;
// Early-solidify buffer so the background-colour transition finishes before
// the header actually reaches the hero's bottom edge, not exactly at it.
const REVEAL_BUFFER_PX = 40;

export interface HeaderScrollState {
  // 'shrink' — ThemeDrivenHeader swaps its own height/padding key to
  // 'compact' when true (reusing the existing HEADER_ROWS_PY/
  // HEADER_CLASSIC_PY tables from C1, no new padding scale).
  shrunk: boolean;
  // 'hide-on-scroll' — the whole <header> (ShopLayoutClient) translates off
  // screen when true.
  hidden: boolean;
  // 'reveal-on-hero' — false means "stay transparent" (only reachable when
  // transparentOnHero is also true and a real hero is measured); true means
  // "render the normal solid header". Every other scrollBehavior value (or
  // transparentOnHero: false) always reports solid: true — 'reveal-on-hero'
  // consumes transparentOnHero, it doesn't have independent meaning without
  // it (see the plan's decision record).
  solid: boolean;
}

// §8.7 item 2 — header.settings.scrollBehavior. Shared by ShopLayoutClient.tsx
// (owns the ancestor <header>'s sticky/hidden/transparent-vs-solid — that's
// where the header's real opaque background lives, via bg-header) and
// ThemeDrivenHeader.tsx (owns its own div's padding-shrink only). All three
// states are CSS-transition-driven (transform/padding/background-color)
// triggered by a class/style toggle, not a continuous JS animation loop —
// the existing blanket prefers-reduced-motion rule in globals.css already
// neutralizes those transitions with zero additions here. The scroll
// listener itself (via useScrollValue) stays active under reduced motion —
// the header still hides/shrinks/solidifies, a real functional behaviour,
// not an animation; only the animated transition is skipped.
export function useHeaderScrollState(scrollBehavior: string, transparentOnHero: boolean): HeaderScrollState {
  const { y, direction } = useScrollValue();
  const [heroHeight, setHeroHeight] = useState<number | null>(null);

  useEffect(() => {
    if (scrollBehavior !== "reveal-on-hero") return;
    function measure() {
      const hero = document.querySelector<HTMLElement>("[data-theme-hero]");
      setHeroHeight(hero ? hero.getBoundingClientRect().height : null);
    }
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [scrollBehavior]);

  const shrunk = scrollBehavior === "shrink" && y > SHRINK_THRESHOLD_PX;
  const hidden = scrollBehavior === "hide-on-scroll" && direction === "down" && y > HIDE_THRESHOLD_PX;
  const solid =
    scrollBehavior === "reveal-on-hero" ? !transparentOnHero || heroHeight === null || y > heroHeight - REVEAL_BUFFER_PX : true;

  return { shrunk, hidden, solid };
}
