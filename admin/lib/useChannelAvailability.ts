"use client";

import { useEffect, useState } from "react";
import { getChannelAvailability } from "@/lib/api";
import type { ChannelAvailability } from "@/lib/types";

// One tiny read ("is the feature on, and does this shop already have a
// connection") shared by everything in the Orders area that would otherwise
// show marketplace UI to a shop that has none. A failure, or a missing endpoint,
// means "nothing to show": the Orders area must never break over this.
const TTL_MS = 60_000;
let cache: { at: number; promise: Promise<ChannelAvailability | null> } | null = null;

export function resetChannelAvailabilityCache() {
  cache = null;
}

function load(): Promise<ChannelAvailability | null> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  const promise = Promise.resolve()
    .then(() => getChannelAvailability())
    .catch(() => null);
  cache = { at: Date.now(), promise };
  return promise;
}

// undefined while loading, null when it could not be read.
export function useChannelAvailability(enabled = true): ChannelAvailability | null | undefined {
  const [value, setValue] = useState<ChannelAvailability | null | undefined>(undefined);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load().then((v) => {
      if (live) setValue(v);
    });
    return () => {
      live = false;
    };
  }, [enabled]);
  return enabled ? value : null;
}

// The marketplace desk exists when the shop has the feature or any connection.
export function marketplaceDeskVisible(a: ChannelAvailability | null | undefined): boolean {
  return !!a && (a.enabled || a.hasConnections);
}
