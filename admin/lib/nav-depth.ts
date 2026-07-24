// Tracks how many in-app client-side navigations have happened in this tab
// (sessionStorage, not a JS module variable, so it survives a page refresh —
// matching real browser history, which also survives refreshes). A fresh
// tab landing directly on a deep link (bookmark, shared URL) starts at 0,
// which is how BackButton knows router.back() has nothing to go back to.
const KEY = "requital_nav_depth";

export function getNavDepth(): number {
  if (typeof window === "undefined") return 0;
  return Number(sessionStorage.getItem(KEY) ?? "0");
}

export function markNavigation() {
  sessionStorage.setItem(KEY, String(getNavDepth() + 1));
}
