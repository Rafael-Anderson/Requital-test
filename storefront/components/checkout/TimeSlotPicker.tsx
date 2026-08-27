"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Clock } from "lucide-react";
import { FIELD_CLASS } from "./checkout-field-styles";

// A single styled dropdown trigger + role="listbox" popover, replacing the
// old grid of loose chip buttons — same interaction pattern as the
// collections page's own Sort dropdown (app/[shop]/collections/[slug]/page.tsx's
// SortDropdown: trigger button, absolute popover, outside-click/Escape to
// close, Check icon on the selected option), matching this checkout's own
// FIELD_CLASS visual treatment rather than that page's. "No preference" is
// gone entirely — a time slot is now required once a date is picked (see
// useCheckoutForm.ts's canSubmit), so there's no valid empty state for this
// control to represent once it's actually rendered.
export default function TimeSlotPicker({
  slots,
  value,
  onChange,
}: {
  slots: string[];
  value: string;
  onChange: (slot: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
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

  if (slots.length === 0) {
    return (
      <div className={`${FIELD_CLASS} flex items-center text-zinc-400 cursor-not-allowed`}>
        No time slots available
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className={`${FIELD_CLASS} flex items-center justify-between gap-2 cursor-pointer text-left`}
      >
        <span className="flex items-center gap-2 truncate">
          <Clock className="size-4 shrink-0 text-zinc-400" />
          <span className={value ? "" : "text-zinc-400"}>{value || "Select a time slot"}</span>
        </span>
        <ChevronDown className="size-4 shrink-0 text-zinc-400" />
      </button>
      {open && (
        <div
          role="listbox"
          className={`dropdown-in absolute left-0 top-full z-20 mt-1 w-full max-h-64 overflow-y-auto rounded-lg border border-stroke bg-background py-1 shadow-lg shadow-black/10`}
        >
          {slots.map((s) => (
            <button
              key={s}
              type="button"
              role="option"
              aria-selected={s === value}
              onClick={() => {
                onChange(s);
                setOpen(false);
              }}
              className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-sm text-foreground hover:bg-black/5 transition-colors cursor-pointer"
            >
              <span>{s}</span>
              {s === value && <Check className="size-3.5 shrink-0 text-accent" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
