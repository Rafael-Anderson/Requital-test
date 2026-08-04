"use client";

// Thin progress bar for App Router navigation. Next.js's App Router doesn't
// expose router "navigation start" events to userland the way Pages Router
// did (see node_modules/next/dist/docs/01-app/01-getting-started/
// 04-linking-and-navigating.md — the framework's own suggested patterns are
// per-link useLinkStatus or "a progress bar" via a global click listener),
// so this pairs the two halves by hand: a capture-phase click listener
// starts the bar the instant an internal link is clicked (before the route
// has even begun rendering — this is what makes it feel instant, not the
// route change itself), and usePathname()'s effect finishes it once the new
// route has actually mounted.
import NProgress from "nprogress";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

NProgress.configure({ showSpinner: false, trickleSpeed: 100 });

export default function NavigationProgress() {
  const pathname = usePathname();

  // Fires after every completed navigation, including the very first
  // render — NProgress.done() on an already-idle bar is a no-op, so this
  // doesn't need to distinguish "did we actually start" first.
  useEffect(() => {
    NProgress.done();
  }, [pathname]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      // Modified clicks (open in new tab, etc.) and non-primary buttons
      // never navigate this tab, so the bar shouldn't start for them.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.defaultPrevented) return;

      const anchor = (e.target as HTMLElement | null)?.closest("a");
      if (!anchor) return;
      if (anchor.target && anchor.target !== "_self") return;
      if (anchor.hasAttribute("download")) return;

      const href = anchor.getAttribute("href");
      if (!href) return;

      let url: URL;
      try {
        url = new URL(href, window.location.href);
      } catch {
        return;
      }

      // External origins, mailto:/tel:/etc, and same-page hash links all
      // skip the client-side router (or don't navigate at all) — none of
      // them fire the pathname effect that would ever call done().
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      NProgress.start();
    }

    // Capture phase: fires before the click reaches Link's own handler, so
    // the bar appears in the same frame as the click rather than racing it.
    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, []);

  return null;
}
