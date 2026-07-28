"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Same open/close/click-outside/escape behavior as components/UserMenu.tsx's
// profile dropdown — extracted here since "New product"/"New ingredient"
// need the identical pattern (a button that opens a small menu) rather than
// duplicating the effect twice more.
export default function DropdownMenu({
  trigger,
  children,
  align = "right",
}: {
  trigger: (state: { open: boolean; toggle: () => void }) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      {trigger({ open, toggle: () => setOpen((o) => !o) })}
      {open && (
        <div
          role="menu"
          className={`absolute ${align === "right" ? "right-0" : "left-0"} top-full mt-2 w-52 rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg shadow-black/10 py-1.5 z-50`}
        >
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  );
}
