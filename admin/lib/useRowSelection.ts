"use client";

import { useMemo, useState } from "react";

// Shared multi-select state for list-page bulk actions (Products, Orders,
// Customers) — selection is keyed by id and cleared whenever the visible
// id set changes size to 0 isn't assumed; callers call `clear()` explicitly
// after a bulk action completes/refreshes the list.
//
// `resetKey` ties the selection to the VIEW it was made in (a paginated list passes
// page + page size + filters): when it changes the selection is emptied during the
// same render, so a bulk action can never act on rows that are no longer on screen.
export function useRowSelection(visibleIds: number[], resetKey?: string) {
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [seenKey, setSeenKey] = useState(resetKey);
  if (resetKey !== seenKey) {
    setSeenKey(resetKey);
    setSelected(new Set());
  }

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const someSelected = visibleIds.some((id) => selected.has(id));

  function toggle(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) => {
      if (visibleIds.every((id) => prev.has(id))) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      return new Set([...prev, ...visibleIds]);
    });
  }

  function clear() {
    setSelected(new Set());
  }

  const selectedIds = useMemo(() => [...selected], [selected]);

  return { selected, selectedIds, allSelected, someSelected, toggle, toggleAll, clear };
}
