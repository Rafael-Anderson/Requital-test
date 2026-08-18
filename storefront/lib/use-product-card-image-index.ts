"use client";

import { useEffect, useRef, useState } from "react";

// Product card image behavior on hover (storefront-v2 Phase 2E/2F), unified
// into one small hook since both read/write the same "which image index is
// showing" state: `cycle` auto-advances through every image every 600ms
// while hovered (globalSettings.productCards.showCarousel), independent of
// `swapOnHover` which just jumps to the second image while hovered, no
// interval (hoverEffect === "swap"). If both are on, cycling already
// visits every image including the second one, so it simply wins — no
// need for the two to fight over the same index state.
export function useProductCardImageIndex(imageCount: number, opts: { cycle: boolean; swapOnHover: boolean }) {
  const [index, setIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  function onMouseEnter() {
    setHovered(true);
    if (opts.cycle && imageCount > 1) {
      timer.current = setInterval(() => setIndex((i) => (i + 1) % imageCount), 600);
    }
  }
  function onMouseLeave() {
    setHovered(false);
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    setIndex(0);
  }
  useEffect(() => {
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const activeIndex = opts.cycle ? index : opts.swapOnHover && hovered && imageCount > 1 ? 1 : 0;
  return { activeIndex, handlers: { onMouseEnter, onMouseLeave } };
}
