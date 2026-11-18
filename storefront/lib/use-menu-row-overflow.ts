"use client";

import { useLayoutEffect, useState, type RefObject } from "react";

// The phone menu row (MenuBar.tsx): how many top-level items fit on ONE line, and how many lines
// all of them need. The answer is read from a measuring copy of the row (zero height, invisible,
// inert) laid out with flex-wrap at the real row's width, so it is the browser's own line breaking,
// not an estimate: the items on the first line are exactly the ones that fit collapsed, and the
// number of lines is the number of rows the expanded menu wraps into.

export type MenuRowLines = {
  /** Items that fit on the first line. */
  fitCount: number;
  /** Lines needed to show every item. */
  rows: number;
};

// Items whose tops differ by at most this many px sit on the same line (sub-pixel layout and items
// of slightly different heights centred on a line).
const SAME_LINE_PX = 2;

/** Pure line count from each item's top edge, in DOM order. */
export function linesFromTops(tops: number[]): MenuRowLines {
  if (tops.length === 0) return { fitCount: 0, rows: 0 };
  const first = tops[0];
  let fitCount = 0;
  while (fitCount < tops.length && Math.abs(tops[fitCount] - first) <= SAME_LINE_PX) fitCount++;
  const lineTops: number[] = [];
  for (const t of tops) {
    if (!lineTops.some((l) => Math.abs(l - t) <= SAME_LINE_PX)) lineTops.push(t);
  }
  return { fitCount, rows: lineTops.length };
}

/**
 * Measures the children of `measureRef` and re-measures whenever the copy or any item changes size
 * (viewport resize, rotation, a web font arriving, a different menu). `fitCount` is null until the
 * first measurement, which runs in a layout effect so it lands before the first paint. A copy that
 * is not rendered (display:none at desktop widths) measures as one line: nothing overflows.
 */
export function useMenuRowOverflow(measureRef: RefObject<HTMLElement | null>, contentKey: unknown) {
  const [lines, setLines] = useState<MenuRowLines | null>(null);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    let cancelled = false;
    const measure = () => {
      if (cancelled) return;
      const tops = Array.from(el.children).map((c) => c.getBoundingClientRect().top);
      const next = linesFromTops(tops);
      setLines((prev) => (prev && prev.fitCount === next.fitCount && prev.rows === next.rows ? prev : next));
    };
    measure();

    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(el);
      for (const child of Array.from(el.children)) ro.observe(child);
    }
    window.addEventListener("resize", measure);
    window.addEventListener("orientationchange", measure);
    const fonts = typeof document !== "undefined" ? document.fonts : undefined;
    fonts?.ready.then(measure).catch(() => undefined);
    fonts?.addEventListener?.("loadingdone", measure);
    return () => {
      cancelled = true;
      ro?.disconnect();
      window.removeEventListener("resize", measure);
      window.removeEventListener("orientationchange", measure);
      fonts?.removeEventListener?.("loadingdone", measure);
    };
  }, [measureRef, contentKey]);

  return {
    fitCount: lines?.fitCount ?? null,
    rows: lines?.rows ?? 0,
    /** At least one item does not fit on one line. */
    overflowing: lines !== null && lines.rows > 1,
  };
}
