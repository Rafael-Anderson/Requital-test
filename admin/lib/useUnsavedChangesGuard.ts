"use client";

import { useEffect, type RefObject } from "react";

// Warns before any in-app link click or tab close/refresh while the caller
// is mounted — a capture-phase `document` click listener, same technique
// NavigationProgress.tsx uses for its own global click listener, repurposed
// here to confirm instead of starting a progress bar. `suppressRef` is
// flipped just before an intentional programmatic navigation (successful
// save, Cancel) so that navigation isn't itself blocked.
//
// Extracted from ProductForm.tsx (the wizard this pattern originated in) so
// AccountSetup.tsx's Account Setup wizard can share it instead of a second
// copy — both are multi-step wizards with the same "don't lose typed data by
// accident" requirement.
export function useUnsavedChangesGuard(suppressRef: RefObject<boolean>) {
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (suppressRef.current) return;
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
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      if (!window.confirm("You have unsaved changes — leave?")) {
        e.preventDefault();
      }
    }

    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (suppressRef.current) return;
      e.preventDefault();
      e.returnValue = "";
    }

    document.addEventListener("click", handleClick, true);
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      document.removeEventListener("click", handleClick, true);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
