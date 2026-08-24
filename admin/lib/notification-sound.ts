"use client";

import { useEffect, useState } from "react";

// Flat, unscoped localStorage key — same device-scoped convention as this
// app's only two other localStorage keys (requital_admin_access_token,
// requital_theme). No per-user-scoped local-storage infra exists anywhere
// in this app to imitate instead.
const MUTE_KEY = "requital_mute_order_sound";

export function isSoundMuted(): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(MUTE_KEY) === "true";
}

// Mirrors lib/theme.ts's useTheme() shape — read-on-mount local state,
// written straight to localStorage on change, no cross-tab sync needed
// (the mute check in NewOrderBanner re-reads localStorage fresh on every
// poll tick anyway, so a toggle in one tab takes effect on the very next
// tick everywhere, not just via React state).
export function useMuteOrderSound() {
  const [muted, setMutedState] = useState(false);

  useEffect(() => {
    setMutedState(isSoundMuted());
  }, []);

  function setMuted(next: boolean) {
    localStorage.setItem(MUTE_KEY, next ? "true" : "false");
    setMutedState(next);
  }

  return { muted, setMuted };
}

// Fire-and-forget — browsers reject Audio.play() when it's called outside a
// user gesture under some autoplay policies; a rejected promise here just
// means silence, not a broken notification (the visible banner still shows
// regardless of whether the sound played).
export function playOrderSound() {
  if (isSoundMuted()) return;
  try {
    void new Audio("/new-order.wav").play().catch(() => {});
  } catch {
    // Audio construction itself can throw in some environments (e.g. SSR,
    // though this is only ever called client-side) — swallow the same way.
  }
}

// Pure and directly unit-testable on purpose — the "is this order genuinely
// new since the session started" logic, pulled out of NewOrderBanner so it
// needs no timers/mocking to test. `seen` is mutated in place (the id set
// the caller is accumulating across polls); the return value is just the
// subset of `fetchedIds` that weren't already in it before this call.
export function diffNewOrderIds(seen: Set<number>, fetchedIds: number[]): number[] {
  const newIds = fetchedIds.filter((id) => !seen.has(id));
  for (const id of fetchedIds) seen.add(id);
  return newIds;
}
