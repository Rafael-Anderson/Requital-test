"use client";

import { useCallback, useEffect, useState } from "react";
import { getChannelAvailability } from "@/lib/api";
import type { ChannelAvailability } from "@/lib/types";

// One tiny read ("is the feature on, and does this shop already have a
// connection") shared by everything in the Orders area that would otherwise
// show marketplace UI to a shop that has none. Cached for a minute so moving
// between Orders tabs does not ask again; a failure is never cached.
const TTL_MS = 60_000;
let cache: { at: number; promise: Promise<ChannelAvailability> } | null = null;

export function resetChannelAvailabilityCache() {
  cache = null;
}

function load(force: boolean): Promise<ChannelAvailability> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return cache.promise;
  // Promise.resolve().then so even a synchronous throw becomes a rejection.
  const promise = Promise.resolve().then(() => getChannelAvailability());
  cache = { at: Date.now(), promise };
  promise.catch(() => {
    if (cache?.promise === promise) cache = null;
  });
  return promise;
}

export interface ChannelAvailabilityState {
  // undefined while loading, null when it could not be read or `enabled` is false.
  data: ChannelAvailability | null | undefined;
  failed: boolean;
  retry: () => void;
}

export function useChannelAvailability(enabled = true): ChannelAvailabilityState {
  const [result, setResult] = useState<{ data: ChannelAvailability | null; failed: boolean } | undefined>(undefined);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    load(attempt > 0).then(
      (data) => live && setResult({ data, failed: false }),
      () => live && setResult({ data: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [enabled, attempt]);
  const retry = useCallback(() => {
    setResult(undefined);
    setAttempt((a) => a + 1);
  }, []);
  return { data: enabled ? (result ? result.data : undefined) : null, failed: enabled && !!result?.failed, retry };
}

// The marketplace desk exists when the shop has the feature or any connection.
export function marketplaceDeskVisible(a: ChannelAvailability | null | undefined): boolean {
  return !!a && (a.enabled || a.hasConnections);
}
