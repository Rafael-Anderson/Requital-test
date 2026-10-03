"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// A sideways scroll container with a visible affordance: a soft fade on each
// edge that still has hidden content. The fade follows the live scroll state
// (and a resize), so a region that fits shows none. Logical edges, so it works
// in RTL (scrollLeft goes negative there, hence Math.abs). The fade overlays
// sit outside the scroller and never intercept pointer events.
// `startFade={false}` is for a region whose first column is `sticky start-0`
// (the settings sidebar), where a fade over that column would only blur it.
const fade =
  "pointer-events-none absolute inset-y-0 w-6 from-background to-transparent transition-opacity duration-150";

export default function ScrollFade({
  className = "",
  children,
  startFade = true,
}: {
  className?: string;
  children: ReactNode;
  startFade?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });

  const update = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const x = Math.abs(el.scrollLeft);
    const next = { start: x > 1, end: x + el.clientWidth < el.scrollWidth - 1 };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);

  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [update]);

  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className={`overflow-x-auto ${className}`} data-scroll-fade>
        {children}
      </div>
      {startFade && (
        <span
          aria-hidden="true"
          data-fade="start"
          className={`${fade} start-0 bg-linear-to-r rtl:bg-linear-to-l ${edges.start ? "opacity-100" : "opacity-0"}`}
        />
      )}
      <span
        aria-hidden="true"
        data-fade="end"
        className={`${fade} end-0 bg-linear-to-l rtl:bg-linear-to-r ${edges.end ? "opacity-100" : "opacity-0"}`}
      />
    </div>
  );
}
