import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

// false while the server renders AND during hydration, true on every client render after.
// For things that need `document` (portals) in a component that is now server-rendered:
// rendering them on the first client pass would differ from the server HTML.
export function useIsClient(): boolean {
  return useSyncExternalStore(subscribe, () => true, () => false);
}
