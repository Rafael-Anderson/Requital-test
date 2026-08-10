"use client";

import { useId, type ReactNode } from "react";

// Shared hover/focus tooltip for any control that isn't self-explanatory
// from its visible label alone (icon-only buttons, toggles with a
// non-obvious consequence, ambiguous settings fields, status badges).
// CSS-only show/hide (group-hover + group-focus-within), no JS state or
// viewport measurement — side/align are caller-supplied static hints, same
// lazy edge-clipping approach DropdownMenu.tsx already uses (its own
// align="left"|"right" prop) rather than adding a positioning library.
type Side = "top" | "bottom" | "left" | "right";
type Align = "start" | "center" | "end";

const POSITION_CLASS: Record<Side, Record<Align, string>> = {
  top: {
    start: "bottom-full left-0 mb-2",
    center: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    end: "bottom-full right-0 mb-2",
  },
  bottom: {
    start: "top-full left-0 mt-2",
    center: "top-full left-1/2 -translate-x-1/2 mt-2",
    end: "top-full right-0 mt-2",
  },
  left: {
    start: "right-full top-0 mr-2",
    center: "right-full top-1/2 -translate-y-1/2 mr-2",
    end: "right-full bottom-0 mr-2",
  },
  right: {
    start: "left-full top-0 ml-2",
    center: "left-full top-1/2 -translate-y-1/2 ml-2",
    end: "left-full bottom-0 ml-2",
  },
};

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

  if (disabled) return <>{children}</>;

  return (
    <span className="group/tooltip relative inline-flex" aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className={`pointer-events-none absolute z-50 max-w-56 whitespace-normal rounded-md bg-zinc-900 dark:bg-zinc-700 px-2.5 py-1.5 text-center text-xs text-white opacity-0 shadow-lg shadow-black/10 transition-opacity duration-150 group-hover/tooltip:opacity-100 group-focus-within/tooltip:opacity-100 ${POSITION_CLASS[side][align]}`}
      >
        {label}
      </span>
    </span>
  );
}
