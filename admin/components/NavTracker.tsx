"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { markNavigation } from "@/lib/nav-depth";

// Mounted once at the root — records every route change so BackButton can
// tell "user navigated here within the app" apart from "user landed here
// directly" (bookmark/shared link), without a manual per-page parent map.
export default function NavTracker() {
  const pathname = usePathname();
  const isFirstRender = useRef(true);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }
    markNavigation();
  }, [pathname]);

  return null;
}
