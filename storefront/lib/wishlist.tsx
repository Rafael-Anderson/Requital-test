"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useAuth } from "./auth";
import { getMyWishlistIds, addToWishlist as apiAdd, removeFromWishlist as apiRemove } from "./api";
import type { ThemeConfig } from "./theme-config-types";

// Matches the backend's WISHLIST_MAX (customer-account.service.ts). An add
// past this is a no-op locally / a 409 server-side.
export const WISHLIST_MAX = 100;

function storageKey(shopSlug: string) {
  return `requital_storefront_wishlist:${shopSlug}`;
}

// One place both the /account/wishlist page and WishlistButton consult, so
// the "absent ⇒ no wishlist UI at all" gate can't drift between them.
export function wishlistEnabled(themeConfig: ThemeConfig | null | undefined): boolean {
  return themeConfig?.globalSettings?.productCards?.showWishlist === true;
}

// --- pure helpers (unit-tested in wishlist.test.ts) ---------------------

export function readLocalWishlist(shopSlug: string): number[] {
  try {
    const raw = localStorage.getItem(storageKey(shopSlug));
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (v): v is number => typeof v === "number" && Number.isInteger(v) && v > 0,
    );
  } catch {
    // corrupt / blocked storage — treat as empty rather than crash
    return [];
  }
}

export function writeLocalWishlist(shopSlug: string, ids: number[]): void {
  try {
    localStorage.setItem(storageKey(shopSlug), JSON.stringify(ids));
  } catch {
    // private-mode / quota — a lost local wishlist is acceptable, a crash isn't
  }
}

// Union on login: keep the server's order, append any local id the server
// doesn't have, stop at the cap (first-capped-wins — an over-long merge
// silently drops the tail rather than failing the login).
export function mergeWishlists(
  serverIds: number[],
  localIds: number[],
  max: number = WISHLIST_MAX,
): number[] {
  const seen = new Set(serverIds);
  const merged = serverIds.slice(0, max);
  for (const id of localIds) {
    if (merged.length >= max) break;
    if (!seen.has(id)) {
      merged.push(id);
      seen.add(id);
    }
  }
  return merged;
}

// Toggle with the cap applied in both modes — adding at the cap is a no-op
// (returns the same list), never an eviction.
export function toggleInList(ids: number[], productId: number, max: number = WISHLIST_MAX): number[] {
  if (ids.includes(productId)) return ids.filter((id) => id !== productId);
  if (ids.length >= max) return ids;
  return [...ids, productId];
}

// --- context ----------------------------------------------------------------

interface WishlistContextValue {
  ids: number[];
  has: (productId: number) => boolean;
  toggle: (productId: number) => void;
  ready: boolean;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

export function WishlistProvider({ shopSlug, children }: { shopSlug: string; children: React.ReactNode }) {
  const { customer, loading: authLoading } = useAuth();
  const customerId = customer?.id ?? null;
  const [ids, setIds] = useState<number[]>([]);
  const [ready, setReady] = useState(false);
  // The mode toggle's source of truth for `toggle` without re-creating it on
  // every render — it reads .current, not a closed-over value.
  const serverBacked = useRef(false);

  useEffect(() => {
    if (authLoading) return;
    let cancelled = false;

    // Whole body is async so every setState below runs in a microtask, not
    // synchronously in the effect (avoids react-hooks/set-state-in-effect
    // while keeping the localStorage read, which is itself synchronous).
    (async () => {
      const local = readLocalWishlist(shopSlug);

      if (customerId === null) {
        serverBacked.current = false;
        if (!cancelled) {
          setIds(local);
          setReady(true);
        }
        return;
      }

      // Logged in: pull the server list, merge any local ids up, then run
      // server-backed. A merge id the server lacks is POSTed one at a time
      // (best-effort — a failed push just means it isn't synced this
      // session, the local copy is only cleared after the loop).
      if (!cancelled) setReady(false);
      try {
        const serverIds = await getMyWishlistIds(shopSlug);
        const merged = mergeWishlists(serverIds, local);
        const toPush = merged.filter((id) => !serverIds.includes(id));
        for (const id of toPush) {
          try {
            await apiAdd(shopSlug, id);
          } catch {
            // leave it in the merged list for display; retried next login
          }
        }
        if (cancelled) return;
        writeLocalWishlist(shopSlug, []);
        serverBacked.current = true;
        setIds(merged);
        setReady(true);
      } catch {
        // Couldn't reach the server — fall back to the local list rather
        // than showing an empty wishlist for a logged-in shopper.
        if (cancelled) return;
        serverBacked.current = false;
        setIds(local);
        setReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [shopSlug, customerId, authLoading]);

  const has = useCallback((productId: number) => ids.includes(productId), [ids]);

  const toggle = useCallback(
    (productId: number) => {
      setIds((prev) => {
        const next = toggleInList(prev, productId);
        if (next === prev) return prev; // cap hit — nothing changed

        const wasAdded = next.length > prev.length;
        if (serverBacked.current) {
          const req = wasAdded ? apiAdd(shopSlug, productId) : apiRemove(shopSlug, productId);
          req.catch(() => {
            // revert the optimistic change on failure (e.g. a 409 at the cap)
            setIds((cur) =>
              wasAdded ? cur.filter((id) => id !== productId) : [...cur, productId],
            );
          });
        } else {
          writeLocalWishlist(shopSlug, next);
        }
        return next;
      });
    },
    [shopSlug],
  );

  return (
    <WishlistContext.Provider value={{ ids, has, toggle, ready }}>
      {children}
    </WishlistContext.Provider>
  );
}

// Deliberately tolerant, unlike useCart/useAuth: WishlistButton lives inside
// ProductCard, which renders in many trees (search, related products,
// collection pages, homepage sections, the theme-builder preview). A missing
// provider makes the heart an inert no-op rather than crashing a whole
// product grid over a non-critical adornment. The provider is always mounted
// on real shop pages (ShopLayoutClient); this fallback is for stray renders
// and unit tests that don't wrap it.
const INERT_WISHLIST: WishlistContextValue = {
  ids: [],
  has: () => false,
  toggle: () => {},
  ready: false,
};

export function useWishlist() {
  return useContext(WishlistContext) ?? INERT_WISHLIST;
}
