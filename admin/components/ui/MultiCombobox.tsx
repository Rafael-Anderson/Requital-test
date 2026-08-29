"use client";

// Searchable multi-select (and single-select) dropdown — the same
// trigger/popover/search/click-outside/escape shape as Combobox.tsx, but
// with checkbox rows and a chips summary in the trigger. Used for the
// product form's Collections picker (multi) and Brand picker (single via
// `single`). Plain Tailwind, no Radix/cmdk, matching this app's convention.
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronsUpDown, Plus, X } from "lucide-react";
import Checkbox from "@/components/ui/Checkbox";

export interface MultiComboboxOption {
  value: string;
  label: string;
  // Indent level for a hierarchical list (e.g. the collection tree).
  depth?: number;
}

export default function MultiCombobox({
  label,
  value,
  onChange,
  options,
  single = false,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  emptyText = "No results",
  onCreateNew,
  createLabel,
  className = "",
}: {
  label?: string;
  value: string[];
  onChange: (next: string[]) => void;
  options: MultiComboboxOption[];
  single?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  onCreateNew?: () => void;
  createLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setQuery("");
  }
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listboxId = useId();

  const selectedSet = useMemo(() => new Set(value), [value]);
  const selectedOptions = options.filter((o) => selectedSet.has(o.value));
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

  function toggle(optionValue: string) {
    if (single) {
      onChange(selectedSet.has(optionValue) ? [] : [optionValue]);
      setOpen(false);
      return;
    }
    const next = new Set(selectedSet);
    if (next.has(optionValue)) next.delete(optionValue);
    else next.add(optionValue);
    onChange([...next]);
  }

  return (
    <div className={className}>
      {label && (
        <label className="text-[13px] font-medium text-text-secondary dark:text-zinc-400 block mb-1.5">
          {label}
        </label>
      )}
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={listboxId}
          className="flex min-h-9 w-full items-center justify-between gap-2 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 py-1.5 text-sm outline-none cursor-pointer transition-shadow focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          {selectedOptions.length === 0 ? (
            <span className="truncate text-left text-text-faint">{placeholder}</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {selectedOptions.map((o) => (
                <span
                  key={o.value}
                  className="inline-flex items-center gap-1 rounded-full bg-black/5 dark:bg-white/10 px-2 py-0.5 text-xs"
                >
                  {o.label}
                  <X
                    className="size-3 text-text-faint hover:text-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggle(o.value);
                    }}
                  />
                </span>
              ))}
            </span>
          )}
          <ChevronsUpDown className="size-4 shrink-0 text-text-faint" />
        </button>

        {open && (
          <div
            id={listboxId}
            role="listbox"
            aria-multiselectable={!single}
            className="popover-in absolute left-0 top-full z-50 mt-1.5 w-full rounded-[10px] border border-border dark:border-white/10 bg-surface dark:bg-zinc-900 shadow-lg shadow-black/10 overflow-hidden"
          >
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full h-9 px-3 text-sm outline-none border-b border-black/10 dark:border-white/10 bg-transparent"
            />
            <div className="max-h-56 overflow-y-auto modal-scroll py-1">
              {filtered.length === 0 && (
                <p className="px-3 py-2 text-sm text-zinc-400">{emptyText}</p>
              )}
              {filtered.map((option) => (
                <label
                  key={option.value}
                  style={option.depth ? { paddingLeft: `${12 + option.depth * 16}px` } : undefined}
                  className="flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Checkbox
                    aria-label={option.label}
                    checked={selectedSet.has(option.value)}
                    onChange={() => toggle(option.value)}
                  />
                  <span className="truncate">{option.label}</span>
                </label>
              ))}
            </div>
            {onCreateNew && (
              <button
                type="button"
                onClick={() => {
                  setOpen(false);
                  onCreateNew();
                }}
                className="flex w-full items-center gap-1.5 border-t border-black/10 dark:border-white/10 px-3 py-2 text-sm text-accent-text hover:bg-black/5 dark:hover:bg-white/10 transition-colors cursor-pointer"
              >
                <Plus className="size-4" />
                {createLabel ?? "Create new"}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
