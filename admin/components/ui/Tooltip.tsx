"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

// Shared hover/focus tooltip for any control that isn't self-explanatory
// from its visible label alone (icon-only buttons, toggles with a
// non-obvious consequence, ambiguous settings fields, status badges).
//
// Portaled to document.body with JS-computed position (see PLACEMENT below)
// rather than the CSS-only group-hover approach this used to be — a
// portaled node is no longer a DOM descendant of the trigger, so
// group-hover/group-focus-within (which depend on shared ancestry) can't
// reach it, and portaling is what's needed to escape an ancestor's
// `overflow: hidden`/`overflow-x-auto` (e.g. Table.tsx's scroll wrapper,
// which computes overflow-y as clipped too per the CSS overflow spec once
// overflow-x is non-visible) clipping an absolutely-positioned tooltip
// regardless of z-index. side="top" (the default) is the placement most
// likely to collide with the viewport's top edge for a trigger near the
// page header — flipped to bottom when there isn't room; the symmetric
// bottom-overflow case is handled too, since the mechanism is identical.
type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

const GAP = 8; // px — matches the old mb-2/mt-2/mr-2/ml-2 (0.5rem)
const VIEWPORT_MARGIN = 8; // px clearance kept from the viewport edge
// No two-pass measure-then-reposition render (which would need to briefly
// mount invisibly to measure real height) — tooltip copy is capped at ~2
// lines by design (max-w-[220px] below), so a fixed estimate is enough to
// decide whether a flip is needed without the extra render pass.
const ESTIMATED_HEIGHT = 56;
// Above every other overlay in the app, not just the header — NavigationProgress
// (globals.css) is the previous highest at 9999, explicitly "to sit above
// everything else, modals included" (z-50); a tooltip can appear on a
// trigger that's itself inside a Modal/Toast/DropdownMenu, so it has to
// clear all of them, not just whatever the header happens to use (today,
// TopBar sets no z-index of its own at all).
const TOOLTIP_Z_INDEX = 10000;

// Reference point (viewport px, from the trigger's own getBoundingClientRect)
// plus the CSS transform that offsets the tooltip's own box from that point
// — transform handles centering/anchoring without needing to know the
// tooltip's rendered width up front, the same trick -translate-x-1/2 played
// in the old Tailwind-class version.
const PLACEMENT: Record<
  Side,
  Record<Align, (rect: DOMRect) => { top: number; left: number; transform: string }>
> = {
  top: {
    start: (r) => ({ top: r.top - GAP, left: r.left, transform: "translate(0, -100%)" }),
    center: (r) => ({ top: r.top - GAP, left: r.left + r.width / 2, transform: "translate(-50%, -100%)" }),
    end: (r) => ({ top: r.top - GAP, left: r.right, transform: "translate(-100%, -100%)" }),
  },
  bottom: {
    start: (r) => ({ top: r.bottom + GAP, left: r.left, transform: "translate(0, 0)" }),
    center: (r) => ({ top: r.bottom + GAP, left: r.left + r.width / 2, transform: "translate(-50%, 0)" }),
    end: (r) => ({ top: r.bottom + GAP, left: r.right, transform: "translate(-100%, 0)" }),
  },
  left: {
    start: (r) => ({ top: r.top, left: r.left - GAP, transform: "translate(-100%, 0)" }),
    center: (r) => ({ top: r.top + r.height / 2, left: r.left - GAP, transform: "translate(-100%, -50%)" }),
    end: (r) => ({ top: r.bottom, left: r.left - GAP, transform: "translate(-100%, -100%)" }),
  },
  right: {
    start: (r) => ({ top: r.top, left: r.right + GAP, transform: "translate(0, 0)" }),
    center: (r) => ({ top: r.top + r.height / 2, left: r.right + GAP, transform: "translate(0, -50%)" }),
    end: (r) => ({ top: r.bottom, left: r.right + GAP, transform: "translate(0, -100%)" }),
  },
};

function resolveSide(side: Side, rect: DOMRect): Side {
  if (side === "top" && rect.top - ESTIMATED_HEIGHT - GAP < VIEWPORT_MARGIN) {
    return "bottom";
  }
  if (side === "bottom" && rect.bottom + ESTIMATED_HEIGHT + GAP > window.innerHeight - VIEWPORT_MARGIN) {
    return "top";
  }
  return side;
}

export default function Tooltip({
  label,
  children,
  side = "top",
  align = "center",
  disabled = false,
}: {
  label: string;
  children: ReactNode;
  side?: Side;
  align?: Align;
  disabled?: boolean;
}) {
  const id = useId();
  const triggerRef = useRef<HTMLSpanElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; transform: string } | null>(null);

  function show() {
    if (!triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    const resolvedSide = resolveSide(side, rect);
    setPosition(PLACEMENT[resolvedSide][align](rect));
    setVisible(true);
  }

  function hide() {
    setVisible(false);
  }

  // A tooltip anchored via position: fixed doesn't track the page scrolling
  // underneath it — dismiss on scroll (capture: true, since most scroll
  // containers, e.g. Table.tsx's wrapper, don't bubble scroll to window)
  // rather than let it visually drift away from its trigger.
  useEffect(() => {
    if (!visible) return;
    const onScroll = () => hide();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [visible]);

  if (disabled) return <>{children}</>;

  return (
    <span
      ref={triggerRef}
      className="inline-flex"
      aria-describedby={id}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible &&
        position &&
        createPortal(
          <span
            id={id}
            role="tooltip"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              transform: position.transform,
              zIndex: TOOLTIP_Z_INDEX,
            }}
            className="pointer-events-none max-w-[220px] break-words whitespace-normal rounded-md bg-zinc-900 dark:bg-zinc-700 px-2.5 py-1.5 text-center text-xs text-white shadow-lg shadow-black/10"
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  );
}
