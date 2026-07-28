"use client";

import { useRef } from "react";
import { useToast } from "@/components/ui/Toast";

const UNDO_WINDOW_MS = 6000;

// Optimistic "delete with Undo" for Products/Categories/Discounts/Bio
// Links. The row disappears from the UI immediately; the real DELETE
// request is deferred until the undo window closes. No backend soft-delete
// needed — if Undo is clicked, the API call simply never happens. Bulk
// delete (a separate flow) stays confirm-based, not this pattern — it isn't
// wired through this hook.
export function useUndoableDelete() {
  const toast = useToast();
  const timers = useRef(new Map<string | number, ReturnType<typeof setTimeout>>());

  function deleteWithUndo(params: {
    id: string | number;
    label: string;
    onRemoveLocally: () => void;
    onRestoreLocally: () => void;
    commit: () => Promise<unknown>;
  }) {
    const { id, label, onRemoveLocally, onRestoreLocally, commit } = params;

    // A second delete on the same id while one is already pending — just
    // let the existing timer run rather than stacking timers.
    if (timers.current.has(id)) return;

    onRemoveLocally();
    const timer = setTimeout(async () => {
      timers.current.delete(id);
      try {
        await commit();
      } catch (err) {
        onRestoreLocally();
        toast(err instanceof Error ? err.message : `Failed to delete ${label}`, "error");
      }
    }, UNDO_WINDOW_MS);
    timers.current.set(id, timer);

    toast(`${label} deleted`, "success", {
      duration: UNDO_WINDOW_MS,
      action: {
        label: "Undo",
        onClick: () => {
          const t = timers.current.get(id);
          if (!t) return; // window already closed / already committed
          clearTimeout(t);
          timers.current.delete(id);
          onRestoreLocally();
        },
      },
    });
  }

  return deleteWithUndo;
}
