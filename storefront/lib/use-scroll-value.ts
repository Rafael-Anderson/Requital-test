"use client";

import { useEffect, useRef, useState } from "react";

// Phase A (motion foundation) — one shared, rAF-throttled scroll subscription.
// Nothing in Phase A consumes it; it ships now so the later motion phases
// (parallax, shrink / hide-on-scroll header, scroll-progress bar, scrollspy)
// each subscribe to ONE passive scroll listener instead of adding their own.
// Modelled on the rAF-throttled pointer handling already in SectionWrapper.tsx
// / PreviewInteraction.tsx.
//
// §8.7 item 2 fix (2026-09-05): the header-scrollBehavior scratch-shop pass
// found this hook's value could freeze permanently and never found via any
// prior consumer (BackToTopButton never exercised a real scroll either).
// Two independent bugs, both fixed here:
// 1. rAF alone can starve in a backgrounded/unfocused tab: `onScroll` sets
//    `pending.current = true`, but if the scheduled rAF callback never
//    fires, `read()` never runs and the guard never clears. `setTimeout`
//    isn't tied to the compositor's frame schedule, so racing it against
//    rAF (whichever fires first wins, `done` makes the loser a no-op)
//    guarantees forward progress while keeping today's ~16ms timing in the
//    normal foreground-tab case.
// 2. The real one that was actually blocking every render in dev: React's
//    Strict Mode deliberately mounts an effect, cleans it up, then mounts it
//    again (same fiber, same refs) to catch non-idempotent effects. The
//    cleanup here cancelled the scheduled rAF/timeout from the first
//    mount's sync-on-mount call, but left `pending.current` at `true` --
//    `read()` (the only thing that ever clears it) never got to run. The
//    second (real, final) mount's own sync-on-mount `onScroll()` call then
//    saw a stale `pending: true` and returned immediately, never
//    scheduling anything -- permanently starving every future scroll event
//    for the lifetime of the component. Fix: cleanup resets the guard, not
//    just the timers, so a fresh mount always starts clean.
export interface ScrollValue {
  y: number;
  direction: "up" | "down" | "none";
}

export function useScrollValue(): ScrollValue {
  const [value, setValue] = useState<ScrollValue>(() => ({
    y: typeof window === "undefined" ? 0 : window.scrollY,
    direction: "none",
  }));
  const lastY = useRef(value.y);
  const pending = useRef(false);
  const rafId = useRef(0);
  const fallbackId = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    function read() {
      pending.current = false;
      const y = window.scrollY;
      const dy = y - lastY.current;
      lastY.current = y;
      setValue({ y, direction: dy > 0 ? "down" : dy < 0 ? "up" : "none" });
    }
    function onScroll() {
      if (pending.current) return;
      pending.current = true;
      // Idempotent per scroll-coalescing cycle — `done` guards against both
      // the rAF callback and the setTimeout fallback calling `read()` when
      // both eventually fire (the loser's call becomes a no-op instead of a
      // redundant second read).
      let done = false;
      function runOnce() {
        if (done) return;
        done = true;
        read();
      }
      rafId.current = requestAnimationFrame(runOnce);
      fallbackId.current = setTimeout(runOnce, 100);
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    // Sync once on mount (a page can load already scrolled).
    onScroll();
    return () => {
      window.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(rafId.current);
      clearTimeout(fallbackId.current);
      // Cancelling the scheduled work above means it will never call
      // read() to clear this — clear it here instead, or a Strict-Mode
      // (or any other) remount inherits a stuck `true` and never
      // schedules anything again. See the fix note above.
      pending.current = false;
    };
  }, []);

  return value;
}
