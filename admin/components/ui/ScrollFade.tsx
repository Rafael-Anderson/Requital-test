"use client";

import { useEffect, useRef, type ReactNode } from "react";

// A horizontally scrolling region that says so: an edge fade appears on each
// side that still has content hidden past it (see `.scroll-fade` in
// globals.css). Never put overflow-x on html/body to hide a wide child; give
// the wide child one of these instead. State is written straight to data
// attributes (no React state), so a scroll never re-renders the tree.

// Which physical edges still have hidden content. `scrollLeft` is negative in
// an RTL scroller in the modern engines, hence the Math.abs. Pure so it can be
// unit tested without a layout engine.
export function fadeEdges(scrollLeft: number, clientWidth: number, scrollWidth: number, rtl = false) {
  const travelled = Math.abs(scrollLeft);
  const hasStartHidden = travelled > 1;
  const hasEndHidden = travelled + clientWidth < scrollWidth - 1;
  return rtl ? { lo: hasEndHidden, hi: hasStartHidden } : { lo: hasStartHidden, hi: hasEndHidden };
}

interface Props {
  children: ReactNode;
  className?: string;
  // CSS selector for the element to keep in view (e.g. the active tab). It is
  // centred in the scroller on mount and whenever it changes.
  activeSelector?: string;
  // Default true. false = never fade the start edge: the first column is
  // `sticky start-0` (the settings sidebar) and a fade over it would only blur it.
  startFade?: boolean;
  // The first cell of every table row sticks to the start edge (opaque, with a
  // shadow once scrolled). Only for a table placed directly inside.
  stickyFirst?: boolean;
}

export default function ScrollFade({ children, className = "", activeSelector, stickyFirst = false, startFade = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const rtl = getComputedStyle(el).direction === "rtl";
      const { lo, hi } = fadeEdges(el.scrollLeft, el.clientWidth, el.scrollWidth, rtl);
      el.dataset.fadeLo = lo ? "1" : "0";
      el.dataset.fadeHi = hi ? "1" : "0";
      // Lets a full-width table row (an empty or error state in a colSpan cell)
      // size itself to the visible width instead of the whole scrollable table.
      el.style.setProperty("--sf-w", `${el.clientWidth}px`);
    };
    const reveal = () => {
      const target = activeSelector ? el.querySelector<HTMLElement>(activeSelector) : null;
      if (!target) return;
      const t = target.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      const delta = t.left + t.width / 2 - (r.left + r.width / 2);
      if (Math.abs(delta) > 1) el.scrollLeft += delta;
    };
    reveal();
    update();
    el.addEventListener("scroll", update, { passive: true });
    // Content arriving later (a table that loads after first paint) and the
    // viewport resizing both change what is hidden.
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    for (const child of Array.from(el.children)) ro?.observe(child);
    const mo = typeof MutationObserver === "undefined" ? null : new MutationObserver(update);
    mo?.observe(el, { childList: true, subtree: true });
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [activeSelector]);

  return (
    <div
      ref={ref}
      data-scroll-fade
      data-sticky-first={stickyFirst ? "1" : undefined}
      // A sticky first column covers the start edge itself (it gets a shadow instead).
      data-no-start-fade={!startFade || stickyFirst ? "1" : undefined}
      className={`scroll-fade overflow-x-auto ${className}`}
    >
      {children}
    </div>
  );
}
