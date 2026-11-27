"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import Checkbox from "@/components/ui/Checkbox";
import Select from "@/components/ui/Select";
import {
  ORDER_SOURCES,
  type OrderListSort,
  type OrderSource,
} from "@/lib/order-sources";

// Source filter (All, or any set of registry sources; every source is listed
// even with no orders yet) and the Sort choice, for the orders board and the
// order history. The pages keep both in the URL (lib/order-sources.ts).
export default function OrderSourceControls({
  sources,
  sort,
  onChange,
}: {
  sources: readonly OrderSource[];
  sort: OrderListSort;
  onChange: (next: { sources: OrderSource[]; sort: OrderListSort }) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const all = sources.length === 0;

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function toggle(key: OrderSource) {
    const next = sources.includes(key) ? sources.filter((k) => k !== key) : [...sources, key];
    // Every source ticked is the same as All.
    onChange({ sources: next.length === ORDER_SOURCES.length ? [] : next, sort });
  }

  const summary = all
    ? "All"
    : sources.length === 1
      ? ORDER_SOURCES.find((s) => s.key === sources[0])?.label
      : `${sources.length} selected`;

  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="order-source-controls">
      <div className="relative" ref={rootRef}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-controls={listId}
          className="inline-flex h-9 items-center gap-1.5 rounded-[10px] border border-border dark:border-white/15 bg-surface dark:bg-zinc-900 px-3 text-sm outline-none cursor-pointer focus:border-accent focus:ring-[3px] focus:ring-accent/20"
        >
          <span className="text-text-muted">Source:</span>
          <span className="font-medium text-text-primary dark:text-zinc-100">{summary}</span>
          <ChevronDown className="size-4 text-text-faint" aria-hidden="true" />
        </button>
        {open && (
          <div
            id={listId}
            role="group"
            aria-label="Filter by source"
            className="popover-in absolute start-0 top-full z-50 mt-1.5 min-w-48 rounded-[10px] border border-border dark:border-white/10 bg-surface dark:bg-zinc-900 py-1 shadow-lg shadow-black/10"
          >
            <label className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/10">
              <Checkbox aria-label="All" checked={all} onChange={() => onChange({ sources: [], sort })} />
              <span>All</span>
            </label>
            <div className="my-1 border-t border-border dark:border-white/10" />
            {ORDER_SOURCES.map((s) => (
              <label
                key={s.key}
                className="flex items-center gap-2 px-3 py-1.5 text-sm cursor-pointer hover:bg-black/5 dark:hover:bg-white/10"
              >
                <Checkbox aria-label={s.label} checked={sources.includes(s.key)} onChange={() => toggle(s.key)} />
                <span>{s.label}</span>
              </label>
            ))}
          </div>
        )}
      </div>
      <div className="w-44">
        <Select
          aria-label="Sort orders"
          value={sort}
          onChange={(e) => onChange({ sources: [...sources], sort: e.target.value as OrderListSort })}
        >
          <option value="newest">Sort: Newest first</option>
          <option value="source">Sort: Source</option>
        </Select>
      </div>
    </div>
  );
}
