"use client";

import { useEffect, useSyncExternalStore } from "react";
import { reportMapsError } from "@/lib/api";
import { getMapsFailure, subscribeMapsFailure, type MapsFailure } from "@/lib/google-maps-loader";

// One beacon per error code per page load, however many components ask.
const reported = new Set<string>();

// The current Google Maps failure for this page, or null while Maps is fine (or
// has not been asked for yet: the loader only runs once a MapPicker mounts).
// With a shopSlug it also tells the backend about a NAMED error, once, so the
// merchant sees a key/referrer problem on this host. Nothing here is rendered
// to the shopper.
export function useMapsFailure(shopSlug?: string): MapsFailure | null {
  const failure = useSyncExternalStore(subscribeMapsFailure, getMapsFailure, () => null);
  const code = failure?.code ?? null;
  useEffect(() => {
    if (!shopSlug || !code || reported.has(code)) return;
    reported.add(code);
    reportMapsError(shopSlug, code, window.location.host);
  }, [shopSlug, code]);
  return failure;
}

// Test seam only.
export function resetMapsBeaconForTests() {
  reported.clear();
}
