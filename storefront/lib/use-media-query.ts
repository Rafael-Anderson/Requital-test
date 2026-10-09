import { useSyncExternalStore } from "react";

// A media query as hydration-safe state. These components are server-rendered now, and the
// server cannot know the visitor's motion preference or viewport: the server snapshot is
// always `false` and React re-renders with the real answer right after hydration (a lazy
// useState(matchMedia) would instead hydrate to markup the server never sent). Every caller
// already treats `false` as the safe default for what it gates (no motion preference, no
// wide viewport), so the first paint is the conservative one.
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}
