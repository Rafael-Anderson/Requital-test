"use client";

// Searchable single-select for the long, flat product/collection/outlet
// pickers named in the design brief — a plain <select> has no search, and
// this app's catalogs can run long enough that scanning one becomes the
// bottleneck. Same trigger/popover/list shape as shadcn's Combobox (Popover
// + Command, see its demo) reimplemented in plain Tailwind rather than
// pulling in cmdk/Radix — matches this app's existing no-Radix convention
// (Toggle/Table/DropdownMenu were all built the same way). Reuses
// DropdownMenu.tsx's open/close/click-outside/escape pattern rather than
// duplicating it.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
}

export default function Combobox({
  label,
  value,
  onChange,
  options,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results",
  className = "",
}: {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  options: ComboboxOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // Resets the search box whenever the popover transitions closed->open —
  // adjusted during render (not an effect) per React's guidance for
  // deriving state from a prop/state change, same pattern as
  // ColorPicker.tsx's hex-draft reset.
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery("");
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => inputRef.current?.focus(), 0);
    function handleClickOutside(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function handleEscape(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("keydown", handleEscape);
    return () => {
      clearTimeout(t);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  return (
    <div className={className}>
      {label && <label className="text-sm font-medium text-zinc-600 dark:text-zinc-400 block mb-1.5">{label}</label>}
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          className="flex h-9 w-full items-center justify-between rounded-lg border border-black/15 dark:border-white/15 bg-white dark:bg-zinc-900 px-3 py-2 text-sm shadow-sm shadow-black/5 outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          <span className={`truncate text-left ${selected ? "" : "text-zinc-400"}`}>
            {selected ? selected.label : placeholder}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-zinc-400 ml-2" />
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            className="popover-in absolute left-0 top-full z-50 mt-1.5 w-full rounded-lg border border-black/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg shadow-black/10 overflow-hidden"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 px-3 text-sm outline-none border-b border-black/10 dark:border-white/10 bg-transparent"
            />
            <div className="max-h-56 overflow-y-auto modal-scroll py-1">
              {filtered.length === 0 && <p className="px-3 py-2 text-sm text-zinc-400">{emptyText}</p>}
              {filtered.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={option.value === value}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <span className="truncate">{option.label}</span>
                  {option.value === value && <Check className="size-4 shrink-0 text-accent" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
